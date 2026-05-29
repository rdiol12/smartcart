import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import db from "../utils/db.js";
import {
  searchLimiter,
  authLimiter,
  imageLimiter,
  staticDataLimiter,
} from "../middleware/rateLimiter.js";
import {
  searchProductValidator,
  barcodeValidator,
} from "../middleware/validators.js";
import { logger } from "../utils/logger.js";

const router = Router();

// ============================================
// CACHE IMPLEMENTATION WITH MEMOIZATION
// ============================================

class MemoizedCache {
  constructor(ttl = 24 * 60 * 60 * 1000, nullTtl = 60 * 60 * 1000) {
    this.cache = new Map();
    this.ttl = ttl;
    this.nullTtl = nullTtl;
    this.pendingRequests = new Map();
  }

  getKey(...args) {
    return JSON.stringify(args);
  }

  async memoize(key, fn, customTtl = null) {
    if (this.pendingRequests.has(key)) {
      return this.pendingRequests.get(key);
    }

    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const promise = (async () => {
      try {
        const result = await fn();
        const ttl =
          customTtl !== null ? customTtl : result ? this.ttl : this.nullTtl;
        this.set(key, result, ttl);
        return result;
      } finally {
        this.pendingRequests.delete(key);
      }
    })();

    this.pendingRequests.set(key, promise);
    return promise;
  }

  set(key, value, ttl = null) {
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      ttl: ttl || (value ? this.ttl : this.nullTtl),
    });
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return undefined;

    const isExpired = Date.now() - item.timestamp > item.ttl;
    if (isExpired) {
      this.cache.delete(key);
      return undefined;
    }

    return item.value;
  }

  clear() {
    this.cache.clear();
    this.pendingRequests.clear();
  }

  startCleanup(intervalMs = 60 * 60 * 1000) {
    setInterval(() => {
      for (const [key, item] of this.cache.entries()) {
        if (Date.now() - item.timestamp > item.ttl) {
          this.cache.delete(key);
        }
      }
    }, intervalMs);
  }
}

// Initialize caches
const imageCache = new MemoizedCache(24 * 60 * 60 * 1000, 60 * 60 * 1000);
const searchCache = new MemoizedCache(30 * 1000, 15 * 1000);
const categoryCache = new MemoizedCache(5 * 60 * 1000, 60 * 1000);
const chainCache = new MemoizedCache(5 * 60 * 1000, 60 * 1000);
const productCache = new MemoizedCache(10 * 60 * 1000, 2 * 60 * 1000);

// Start cleanup
imageCache.startCleanup();
searchCache.startCleanup();
categoryCache.startCleanup();
chainCache.startCleanup();
productCache.startCleanup();

// ============================================
// HELPER FUNCTIONS WITH RETRY LOGIC
// ============================================

// Helper function to delay execution
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchOpenFoodFactsImage(barcode, retries = 3) {
  const cacheKey = `off_${barcode}`;

  return imageCache.memoize(cacheKey, async () => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        if (attempt > 1) {
          const waitTime = Math.pow(2, attempt) * 1000;
          logger.info(
            `Retrying OpenFoodFacts for barcode ${barcode} (attempt ${attempt}/${retries}) after ${waitTime}ms`,
          );
          await delay(waitTime);
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const res = await fetch(
          `https://world.openfoodfacts.org/api/v0/product/${barcode}.json`,
          {
            headers: {
              "User-Agent":
                "SmartCart - Educational Project (contact@smartcart.com)",
            },
            signal: controller.signal,
          },
        );

        clearTimeout(timeoutId);

        if (res.status === 429) {
          logger.warn(
            `OpenFoodFacts rate limit hit for barcode ${barcode}, attempt ${attempt}`,
          );
          continue;
        }

        if (!res.ok) {
          logger.warn(
            `OpenFoodFacts returned ${res.status} for barcode ${barcode}`,
          );
          continue;
        }

        const data = await res.json();

        if (data.status === 1 && data.product) {
          const imageUrl =
            data.product.image_url ||
            data.product.image_front_url ||
            data.product.image_ingredients_url ||
            data.product.image_nutrition_url;

          if (imageUrl) {
            logger.info(`✅ Found image for barcode ${barcode}`);
            return imageUrl;
          }
        }

        logger.debug(`No image found for barcode ${barcode}`);
        return null;
      } catch (error) {
        if (error.name === "AbortError") {
          logger.error(`OpenFoodFacts timeout for barcode ${barcode}`);
        } else {
          logger.error(`OpenFoodFacts fetch error (attempt ${attempt}):`, {
            error: error.message,
            barcode,
          });
        }

        if (attempt === retries) {
          return null;
        }
      }
    }
    return null;
  });
}

function generatePlaceholderImage(productName, barcode) {
  const str = productName || barcode || "product";
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  const firstLetter = productName ? productName.charAt(0) : "?";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
    <rect width="200" height="200" fill="hsl(${hue}, 70%, 85%)" rx="10"/>
    <text x="100" y="115" font-family="Arial, Helvetica, sans-serif" font-size="80" font-weight="bold" fill="#333" text-anchor="middle">${firstLetter}</text>
    ${productName ? `<text x="100" y="155" font-family="Arial, sans-serif" font-size="12" fill="#666" text-anchor="middle">${productName.length > 18 ? productName.substring(0, 15) + "..." : productName}</text>` : ""}
  </svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

async function getItemImageFromDB(itemId, barcode) {
  const cacheKey = `item_image_${itemId}`;
  return imageCache.memoize(cacheKey, async () => {
    try {
      const result = await db.query(
        "SELECT name, barcode, image_url FROM app.items WHERE id = $1",
        [itemId],
      );
      if (result.rows.length === 0) return null;
      const item = result.rows[0];

      if (item.image_url) return item.image_url;

      if (item.barcode) {
        logger.info(
          `Fetching image for item ${itemId} with barcode ${item.barcode}`,
        );
        const imageUrl = await fetchOpenFoodFactsImage(item.barcode);

        if (imageUrl) {
          await db.query("UPDATE app.items SET image_url = $1 WHERE id = $2", [
            imageUrl,
            itemId,
          ]);
          logger.info(`Saved image URL for item ${itemId}`);
          return imageUrl;
        }
      }

      const placeholder = generatePlaceholderImage(item.name, item.barcode);
      logger.info(`Generated placeholder for item ${itemId}`);
      return placeholder;
    } catch (error) {
      logger.error("Get item image error", { error: error.message, itemId });
      return generatePlaceholderImage(null, `item_${itemId}`);
    }
  });
}


/**
 * GET /api/items/:id/image
 */
router.get("/items/:id/image", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.json({ image_url: null });
  }

  try {
    const result = await db.query(
      "SELECT barcode FROM app.items WHERE id = $1",
      [id],
    );
    if (result.rows.length === 0) {
      return res.json({ image_url: null });
    }

    const imageUrl = await getItemImageFromDB(id, result.rows[0].barcode);

    if (imageUrl) {
      res.setHeader("Cache-Control", "public, max-age=604800");
    } else {
      res.setHeader("Cache-Control", "public, max-age=3600");
    }

    return res.json({ image_url: imageUrl });
  } catch (error) {
    logger.error("Image endpoint error", { error: error.message, itemId: id });
    return res.json({ image_url: null });
  }
});

/**
 * GET /api/search — Products with images first, then sorted by relevance
 */
router.get(
  "/search",
  searchLimiter,
  searchProductValidator,
  async (req, res) => {
    const search = req.query.q;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    if (!search) {
      return res.json({ rows: [], hasMore: false, nextOffset: 0 });
    }

    const cacheKey = JSON.stringify({
      search,
      limit,
      offset,
      category: req.query.category,
      minPrice: req.query.minPrice,
      maxPrice: req.query.maxPrice,
      sort: req.query.sort,
    });

    const result = await searchCache.memoize(cacheKey, async () => {
      const containsTerm = `%${search}%`;
      const startsWithTerm = `${search}%`;
      const exactTerm = search;
      const category = req.query.category || null;
      const minPrice =
        req.query.minPrice != null ? Number(req.query.minPrice) : null;
      const maxPrice =
        req.query.maxPrice != null ? Number(req.query.maxPrice) : null;
      const sort = req.query.sort || null;

      let orderBy = "";
      if (sort === "price_asc") {
        orderBy = `CASE WHEN i.image_url IS NOT NULL THEN 0 ELSE 1 END,
                   CASE 
                     WHEN i.name = $1 THEN 0 
                     WHEN i.name ILIKE $2 THEN 1 
                     ELSE 2 
                   END,
                   min_price ASC NULLS LAST`;
      } else if (sort === "price_desc") {
        orderBy = `CASE WHEN i.image_url IS NOT NULL THEN 0 ELSE 1 END,
                   CASE 
                     WHEN i.name = $1 THEN 0 
                     WHEN i.name ILIKE $2 THEN 1 
                     ELSE 2 
                   END,
                   min_price DESC NULLS LAST`;
      } else if (sort === "name_asc") {
        orderBy = `CASE WHEN i.image_url IS NOT NULL THEN 0 ELSE 1 END,
                   CASE 
                     WHEN i.name = $1 THEN 0 
                     WHEN i.name ILIKE $2 THEN 1 
                     ELSE 2 
                   END,
                   i.name ASC`;
      } else {
        orderBy = `CASE WHEN i.image_url IS NOT NULL THEN 0 ELSE 1 END,
                   CASE 
                     WHEN i.name = $1 THEN 0 
                     WHEN i.name ILIKE $2 THEN 1 
                     ELSE 2 
                   END,
                   i.name ASC`;
      }

      try {
        const reply = await db.query(
          `SELECT 
             i.id as item_id,
             i.name as item_name,
             i.barcode,
             i.item_code,
             i.category,
             i.image_url,
             MIN(p.price) as min_price
           FROM app.items i
           LEFT JOIN app.prices p ON p.item_id = i.id
           WHERE i.name ILIKE $3
             AND ($4::text IS NULL OR i.category = $4)
             AND ($5::numeric IS NULL OR p.price >= $5)
             AND ($6::numeric IS NULL OR p.price <= $6)
           GROUP BY i.id, i.name, i.barcode, i.item_code, i.category, i.image_url
           ORDER BY ${orderBy}
           LIMIT $7 OFFSET $8`,
          [
            exactTerm,
            startsWithTerm,
            containsTerm,
            category,
            minPrice,
            maxPrice,
            limit + 1,
            offset,
          ],
        );

        const hasMore = reply.rows.length > limit;
        const rows = hasMore ? reply.rows.slice(0, limit) : reply.rows;
        const nextOffset = offset + rows.length;

        const transformedRows = rows.map((row) => ({
          item_id: row.item_id,
          item_name: row.item_name,
          barcode: row.barcode,
          item_code: row.item_code,
          category: row.category,
          image_url: row.image_url,
          price: row.min_price,
          chain_name: null,
        }));

        return { rows: transformedRows, hasMore, nextOffset };
      } catch (e) {
        logger.error("Search error", { error: e.message, stack: e.stack });
        throw e;
      }
    });

    res.json(result);
  },
);

/**
 * GET /api/categories — with static data limiter
 */
router.get("/categories", staticDataLimiter, async (_req, res) => {
  const result = await categoryCache.memoize("categories_list", async () => {
    try {
      const { rows } = await db.query(
        `SELECT DISTINCT category FROM app.items
         WHERE category IS NOT NULL AND category <> ''
         ORDER BY category`,
      );
      return { categories: rows.map((r) => r.category) };
    } catch (err) {
      logger.error("Categories list error", { error: err.message });
      return { categories: [] };
    }
  });
  return res.json(result);
});

/**
 * GET /api/chains-list — with static data limiter
 */
router.get("/chains-list", staticDataLimiter, async (_req, res) => {
  const result = await chainCache.memoize("chains_list", async () => {
    try {
      const { rows } = await db.query(
        `SELECT id, name FROM app.chains ORDER BY name`,
      );
      return { chains: rows };
    } catch (err) {
      logger.error("Chains list error", { error: err.message });
      return { chains: [] };
    }
  });
  return res.json(result);
});

/**
 * GET /api/items/barcode/:barcode — with search limiter
 */
router.get(
  "/items/barcode/:barcode",
  searchLimiter,
  barcodeValidator,
  async (req, res) => {
    const { barcode } = req.params;
    if (!barcode) return res.json({ item: null });

    const cacheKey = `barcode_${barcode}`;
    const result = await productCache.memoize(cacheKey, async () => {
      try {
        const itemResult = await db.query(
          `SELECT id, name, barcode, item_code, image_url FROM app.items WHERE barcode = $1 LIMIT 1`,
          [barcode],
        );
        if (itemResult.rows.length === 0) return { item: null };

        const item = itemResult.rows[0];
        if (!item.image_url) {
          item.image_url = await fetchOpenFoodFactsImage(item.barcode);
        }

        const pricesResult = await db.query(
          `SELECT p.price, c.name as chain_name, b.branch_name
           FROM app.prices p
           JOIN app.branches b ON b.id = p.branch_id
           JOIN app.chains c ON c.id = b.chain_id
           WHERE p.item_id = $1
           ORDER BY p.price ASC`,
          [item.id],
        );
        return { item, prices: pricesResult.rows };
      } catch (e) {
        logger.error("Barcode lookup error", { error: e.message });
        return { item: null };
      }
    });
    return res.json(result);
  },
);

/**
 * GET /api/products/:id — product details
 */
router.get("/products/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: "Invalid product id" });
  }

  const cacheKey = `product_${id}`;
  const result = await productCache.memoize(cacheKey, async () => {
    try {
      const dbResult = await db.query(
        `SELECT i.id AS item_id,
                i.name AS item_name,
                i.barcode,
                i.item_code,
                i.manufacturer,
                i.category,
                i.description,
                i.unit_qty,
                i.image_url,
                p.price,
                c.id AS chain_id,
                c.name AS chain_name,
                b.branch_name
         FROM app.items i
         LEFT JOIN LATERAL (
           SELECT pr.price, pr.branch_id
           FROM app.prices pr
           WHERE pr.item_id = i.id
           ORDER BY pr.price ASC
           LIMIT 1
         ) p ON TRUE
         LEFT JOIN app.branches b ON b.id = p.branch_id
         LEFT JOIN app.chains c ON c.id = b.chain_id
         WHERE i.id = $1`,
        [id],
      );
      if (dbResult.rows.length === 0) return { product: null, notFound: true };
      const product = dbResult.rows[0];
      if (!product.image_url && product.barcode) {
        product.image_url = await fetchOpenFoodFactsImage(product.barcode);
      }
      return { product };
    } catch (e) {
      logger.error("Product lookup error", { error: e.message });
      throw e;
    }
  });

  if (result.notFound) {
    return res.status(404).json({ message: "Product not found" });
  }
  return res.json({ product: result.product });
});

// ============================================
// USER-SPECIFIC ROUTES (require authentication)
// ============================================

/**
 * GET /api/suggestions - Get frequently bought items
 */
router.get("/suggestions", authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT itemname, freq, price, quantity FROM (
         SELECT itemname, COUNT(*) OVER (PARTITION BY itemname) AS freq,
                price, quantity,
                ROW_NUMBER() OVER (PARTITION BY itemname ORDER BY addat DESC) AS rn
         FROM app.list_items li
         JOIN app.list_members lm ON lm.list_id = li.listid
         WHERE lm.user_id = $1
       ) sub
       WHERE rn = 1
       ORDER BY freq DESC
       LIMIT 10`,
      [req.userId],
    );
    return res.json(result.rows);
  } catch (e) {
    logger.error("Suggestions error", { error: e.message });
    return res.status(500).json([]);
  }
});

/**
 * GET /api/products/:id/price-history
 */
router.get(
  "/products/:id/price-history",
  authenticateToken,
  async (req, res) => {
    const itemId = parseInt(req.params.id, 10);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return res.status(400).json({ message: "Invalid product id" });
    }
    try {
      const result = await db.query(
        `SELECT p.price, p.updated_at, c.name as chain_name, b.branch_name
       FROM app.prices p
       JOIN app.branches b ON b.id = p.branch_id
       JOIN app.chains c ON c.id = b.chain_id
       WHERE p.item_id = $1
       ORDER BY p.updated_at DESC`,
        [itemId],
      );
      return res.json({ priceHistory: result.rows });
    } catch (err) {
      logger.error("Error fetching price history", { error: err.message });
      return res.status(500).json({ message: "Error fetching price history" });
    }
  },
);

/**
 * GET /api/predict-quantity/:itemName
 */
router.get(
  "/predict-quantity/:itemName",
  authenticateToken,
  async (req, res) => {
    const itemName = decodeURIComponent(req.params.itemName);
    try {
      const result = await db.query(
        `SELECT quantity FROM app.list_items li
       JOIN app.list_members lm ON lm.list_id = li.listid
       WHERE lm.user_id = $1 AND li.itemname ILIKE $2
       ORDER BY li.addat DESC
       LIMIT 100`,
        [req.userId, itemName],
      );
      if (result.rows.length === 0) {
        return res.json({
          suggestedQuantity: 1,
          avgQuantity: 1,
          timesOrdered: 0,
        });
      }
      const quantities = result.rows.map((r) => parseFloat(r.quantity) || 1);
      const avg = quantities.reduce((a, b) => a + b, 0) / quantities.length;
      return res.json({
        suggestedQuantity: Math.round(avg) || 1,
        avgQuantity: parseFloat(avg.toFixed(2)),
        timesOrdered: quantities.length,
      });
    } catch (err) {
      logger.error("Error predicting quantity", { error: err.message });
      return res.status(500).json({ message: "Error predicting quantity" });
    }
  },
);

/**
 * GET /api/delivery/providers
 */
router.get("/delivery/providers", authenticateToken, (req, res) => {
  const DELIVERY_PROVIDERS = [
    {
      id: 1,
      chain_name: "רמי לוי",
      website_url: "https://www.rami-levy.co.il/he/online",
      icon: "cart-outline",
    },
    {
      id: 2,
      chain_name: "שופרסל",
      website_url: "https://www.shufersal.co.il/online/he/default",
      icon: "storefront-outline",
    },
    {
      id: 3,
      chain_name: "יוחננוף",
      website_url: "https://yochananof.co.il/",
      icon: "basket-outline",
    },
    {
      id: 4,
      chain_name: "ויקטורי",
      website_url: "https://www.victoryonline.co.il/",
      icon: "bag-outline",
    },
    {
      id: 5,
      chain_name: "אושר עד",
      website_url: "https://osherad.co.il/",
      icon: "pricetag-outline",
    },
  ];
  res.json({ providers: DELIVERY_PROVIDERS });
});

export default router;
