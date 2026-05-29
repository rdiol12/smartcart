import { logger } from "./logger.js";

/**
 * Run the price-comparison aggregation for one list. Caller is responsible
 * for any authorization (e.g. assertMember). Returns the payload that the
 * /api/lists/:id/compare endpoint sends to clients.
 */
export default async function comparePrices(db, listId) {
  const itemsRes = await db.query(
    `SELECT li.id, li.itemname, li.quantity, li.product_id, li.price AS user_price
     FROM app.list_items li
     WHERE li.listid = $1`,
    [listId],
  );
  const allItems = itemsRes.rows;

  if (allItems.length === 0) {
    return { chains: [], bestMix: null, totalItems: 0 };
  }

  const linkedItems = allItems.filter((i) => i.product_id);
  const unlinkedItems = allItems.filter((i) => !i.product_id);
  const productIds = linkedItems.map((i) => i.product_id);

  const priceRows = await fetchLinkedPrices(db, productIds);
  const { rows: nameMatchRows, failed: fuzzyMatchFailed } =
    await fetchFuzzyPrices(db, unlinkedItems);

  const nameToProduct = buildNameMatches(nameMatchRows, unlinkedItems);

  const matchableItems = [
    ...linkedItems,
    ...unlinkedItems
      .filter((i) => nameToProduct[i.id])
      .map((i) => ({ ...i, product_id: nameToProduct[i.id] })),
  ];
  const unmatchedItems = unlinkedItems.filter((i) => !nameToProduct[i.id]);
  const allPriceRows = [...priceRows, ...nameMatchRows];

  const chainMap = buildChainMap(allPriceRows);
  const chains = buildChainTotals(chainMap, matchableItems);
  chains.sort((a, b) => a.total - b.total);

  const cheapest =
    chains.length > 0
      ? { chainName: chains[0].chainName, total: chains[0].total }
      : null;
  const mostExpensive =
    chains.length > 1 ? chains[chains.length - 1].total : null;

  const bestMix = buildBestMix(chainMap, matchableItems);

  const savings =
    cheapest && mostExpensive ? mostExpensive - cheapest.total : 0;
  const bestMixSavings =
    bestMix && mostExpensive ? mostExpensive - bestMix.total : 0;

  return {
    chains,
    cheapest,
    bestMix,
    totalItems: allItems.length,
    matchedItems: matchableItems.length,
    unmatchedItems: unmatchedItems.length,
    linkedCount: matchableItems.length,
    unlinkedCount: unmatchedItems.length,
    savings: parseFloat(savings.toFixed(2)),
    bestMixSavings: parseFloat(bestMixSavings.toFixed(2)),
    fuzzyMatchFailed,
  };
}

async function fetchLinkedPrices(db, productIds) {
  if (productIds.length === 0) return [];
  const res = await db.query(
    `SELECT DISTINCT ON (c.id, p.item_id)
            c.id AS chain_id, c.name AS chain_name,
            p.item_id AS product_id, p.price
     FROM app.prices p
     JOIN app.branches b ON p.branch_id = b.id
     JOIN app.chains c ON b.chain_id = c.id
     WHERE p.item_id = ANY($1)
     ORDER BY c.id, p.item_id, p.price ASC`,
    [productIds],
  );
  return res.rows;
}

// Escape LIKE wildcards in user-supplied text so an item literally named
// "100% Orange Juice" matches "100%25 Orange Juice"-style literals instead
// of being interpreted as "everything containing Orange Juice". pg's default
// LIKE escape character is backslash.
function escapeLikePattern(s) {
  return s.replace(/[\\%_]/g, "\\$&");
}

async function fetchFuzzyPrices(db, unlinkedItems) {
  if (unlinkedItems.length === 0) return { rows: [], failed: false };
  const namePatterns = unlinkedItems.map(
    (i) => `%${escapeLikePattern(i.itemname)}%`,
  );
  const placeholders = namePatterns
    .map((_, idx) => `i.name ILIKE $${idx + 1}`)
    .join(" OR ");
  if (!placeholders) return { rows: [], failed: false };

  try {
    const res = await db.query(
      `SELECT DISTINCT ON (c.id, i.id)
              c.id AS chain_id, c.name AS chain_name,
              i.id AS product_id, i.name AS product_name, p.price
       FROM app.prices p
       JOIN app.items i ON p.item_id = i.id
       JOIN app.branches b ON p.branch_id = b.id
       JOIN app.chains c ON b.chain_id = c.id
       WHERE ${placeholders}
       ORDER BY c.id, i.id, p.price ASC`,
      namePatterns,
    );
    return { rows: res.rows, failed: false };
  } catch (err) {
    logger.error("Fuzzy name matching error", { error: err.message });
    return { rows: [], failed: true };
  }
}

function buildNameMatches(nameMatchRows, unlinkedItems) {
  const nameToProduct = {};
  for (const row of nameMatchRows) {
    if (!row.product_name) continue;
    const productNameLower = row.product_name.toLowerCase();
    for (const item of unlinkedItems) {
      if (
        productNameLower.includes(item.itemname.toLowerCase()) &&
        !nameToProduct[item.id]
      ) {
        nameToProduct[item.id] = row.product_id;
      }
    }
  }
  return nameToProduct;
}

function buildChainMap(allPriceRows) {
  const chainMap = {};
  for (const row of allPriceRows) {
    if (!chainMap[row.chain_id]) {
      chainMap[row.chain_id] = {
        chain_id: row.chain_id,
        chain_name: row.chain_name,
        prices: {},
      };
    }
    const pid = row.product_id;
    const price = parseFloat(row.price);
    if (
      !chainMap[row.chain_id].prices[pid] ||
      price < chainMap[row.chain_id].prices[pid]
    ) {
      chainMap[row.chain_id].prices[pid] = price;
    }
  }
  return chainMap;
}

function buildChainTotals(chainMap, matchableItems) {
  return Object.values(chainMap).map((chain) => {
    let total = 0;
    const missing = [];
    const items = matchableItems.map((li) => {
      const price = chain.prices[li.product_id];
      const qty = parseFloat(li.quantity) || 1;
      if (price !== undefined) {
        const subtotal = price * qty;
        total += subtotal;
        return {
          itemName: li.itemname,
          price,
          quantity: qty,
          subtotal,
          available: true,
        };
      }
      missing.push(li.itemname);
      return {
        itemName: li.itemname,
        price: 0,
        quantity: qty,
        subtotal: 0,
        available: false,
      };
    });
    return {
      chainId: chain.chain_id,
      chainName: chain.chain_name,
      total,
      items,
      missing,
      missingCount: missing.length,
      itemCount: items.filter((i) => i.available).length,
      complete: missing.length === 0,
    };
  });
}

function buildBestMix(chainMap, matchableItems) {
  const bestMixItems = [];
  let bestMixTotal = 0;
  const bestMixStores = new Set();

  for (const li of matchableItems) {
    let bestPrice = Infinity;
    let bestChain = null;
    for (const chain of Object.values(chainMap)) {
      const p = chain.prices[li.product_id];
      if (p !== undefined && p < bestPrice) {
        bestPrice = p;
        bestChain = chain.chain_name;
      }
    }
    const qty = parseFloat(li.quantity) || 1;
    if (bestChain) {
      bestMixItems.push({
        item_name: li.itemname,
        price: bestPrice,
        quantity: qty,
        subtotal: bestPrice * qty,
        store: bestChain,
      });
      bestMixTotal += bestPrice * qty;
      bestMixStores.add(bestChain);
    }
  }

  if (bestMixItems.length === 0) return null;
  return {
    total: bestMixTotal,
    items: bestMixItems,
    storeCount: bestMixStores.size,
    stores: [...bestMixStores],
  };
}
