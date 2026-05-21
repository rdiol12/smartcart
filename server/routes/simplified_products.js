import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import db from "../utils/db.js";
import { searchLimiter } from "../middleware/rateLimiter.js";
import {
  searchProductValidator,
  barcodeValidator,
} from "../middleware/validators.js";
import { logger } from "../utils/logger.js";
const router = Router();

// Auth policy in this file:
//   - Product catalog reads (search, barcode lookup, product detail) are
//     PUBLIC. The frontend routes /store and /product/:id are intentionally
//     guest-visible, and the underlying price feeds are themselves public
//     data the chains are required to publish. searchLimiter handles abuse.
//   - User-specific endpoints (suggestions, predict-quantity, price-history,
//     delivery providers) require auth — they expose either user history
//     or are gated UX features.

/**
 * GET /api/search — public catalog search.
 */
router.get("/search", searchLimiter, searchProductValidator, async (req, res) => {
  const search = req.query.q;
  if (!search) return res.json({ rows: [], hasMore: false, nextOffset: 0 });

  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const containsTerm = `%${search}%`;
  const startsWithTerm = `${search}%`;

  try {
    const reply = await db.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (i.id)
         i.id as item_id,
         i.name as item_name,
         i.barcode,
         i.item_code,
         p.price,
         c.id as chain_id,
         c.name as chain_name,
         b.branch_name
         FROM app.items i
         LEFT JOIN app.prices p ON p.item_id = i.id
         LEFT JOIN app.branches b ON b.id = p.branch_id
         LEFT JOIN app.chains c ON c.id = b.chain_id
         WHERE i.name ILIKE $1
         ORDER BY i.id, p.price DESC NULLS LAST
       ) sub
       ORDER BY CASE WHEN sub.item_name ILIKE $2 THEN 0 ELSE 1 END,
                sub.item_name
       LIMIT $3 OFFSET $4`,
      [containsTerm, startsWithTerm, limit + 1, offset],
    );

    const hasMore = reply.rows.length > limit;
    const rows = hasMore ? reply.rows.slice(0, limit) : reply.rows;
    const nextOffset = offset + rows.length;

    res.json({ rows, hasMore, nextOffset });
  } catch (e) {
    logger.error("Search error", { error: e.message });
    return res.status(500).json({ rows: [], hasMore: false, nextOffset: 0 });
  }
});

/**
 * GET /api/items/barcode/:barcode
 * Lookup product by barcode
 */
router.get("/items/barcode/:barcode", searchLimiter, barcodeValidator, async (req, res) => {
  const { barcode } = req.params;

  if (!barcode) {
    return res.json({ item: null });
  }

  try {
    const itemResult = await db.query(
      `SELECT id, name, barcode, item_code, image_url FROM app.items WHERE barcode = $1 LIMIT 1`,
      [barcode],
    );

    if (itemResult.rows.length === 0) {
      return res.json({ item: null });
    }

    const item = itemResult.rows[0];
    const pricesResult = await db.query(
      `SELECT p.price, c.name as chain_name, b.branch_name
       FROM app.prices p
       JOIN app.branches b ON b.id = p.branch_id
       JOIN app.chains c ON c.id = b.chain_id
       WHERE p.item_id = $1
       ORDER BY p.price ASC`,
      [item.id],
    );

    return res.json({ item, prices: pricesResult.rows });
  } catch (e) {
    logger.error("Barcode lookup error", { error: e.message });
    return res.status(500).json({ item: null });
  }
});

/**
 * GET /api/suggestions
 * Get frequently bought items for user
 */
router.get("/suggestions", authenticateToken, async (req, res) => {

  try {
    // Use the most recent price/quantity per item, not MAX. MAX gave the most
    // expensive historical price and the largest historical quantity — i.e.
    // the worst-case "stock up at peak price" — which is the opposite of a
    // useful suggestion. The DISTINCT ON subquery picks the latest row per
    // (user, itemname); the outer query counts how often it was added.
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
 * GET /api/products/:id
 * Product detail page — single item + its cheapest price + chain
 */
router.get("/products/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ message: "Invalid product id" });
  }

  try {
    const result = await db.query(
      `SELECT i.id AS item_id,
              i.name AS item_name,
              i.barcode,
              i.item_code,
              i.manufacturer,
              i.category,
              i.description,
              i.unit_qty,
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

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Product not found" });
    }

    return res.json({ product: result.rows[0] });
  } catch (e) {
    logger.error("Product lookup error", { error: e.message });
    return res.status(500).json({ message: "Error fetching product" });
  }
});

/**
 * GET /api/products/:id/price-history
 * Price history for a product
 */
router.get(
  "/products/:id/price-history",
  authenticateToken,
  async (req, res) => {
    const itemId = req.params.id;

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
      logger.error("Error fetching price history", { error: err.message, stack: err.stack });
      return res.status(500).json({ message: "Error fetching price history" });
    }
  },
);

/**
 * GET /api/predict-quantity/:itemName
 * Smart quantity prediction based on past orders
 */
router.get(
  "/predict-quantity/:itemName",
  authenticateToken,
  async (req, res) => {
    const itemName = decodeURIComponent(req.params.itemName);

    try {
      // LIMIT defends against a malicious or unlucky user with thousands of
      // matching rows OOMing the response. 100 samples is plenty for an
      // average-of-quantities prediction.
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
      const suggested = Math.round(avg);

      return res.json({
        suggestedQuantity: suggested || 1,
        avgQuantity: parseFloat(avg.toFixed(2)),
        timesOrdered: quantities.length,
      });
    } catch (err) {
      logger.error("Error predicting quantity", { error: err.message, stack: err.stack });
      return res.status(500).json({ message: "Error predicting quantity" });
    }
  },
);

/**
 * GET /api/delivery/providers
 * Get delivery provider links
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
