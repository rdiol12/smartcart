import "../utils/env.js";
import XmlStream from "xml-stream-saxjs";
import fs from "fs";
import iconv from "iconv-lite";
import { movetoprocess } from "./organizefiles.js";
import { createPool } from "../utils/db.js";

const db = createPool();

async function asyncPool(limit, items, fn) {
  const results = [];
  const executing = [];
  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item));
    results.push(p);
    const e = p.finally(() => executing.splice(executing.indexOf(e), 1));
    executing.push(e);
    if (executing.length >= limit) await Promise.race(executing);
  }
  return Promise.allSettled(results);
}

const getText = (node) => {
  if (node == null) return "";
  if (typeof node === "string") return node.trim();
  if (typeof node === "object") {
    const text = (node.$text || "").trim();
    if (text) return text;
    const childKeys = Object.keys(node).filter(
      (k) => k !== "$" && k !== "$text",
    );
    if (childKeys.length > 0) {
      const err = new Error(
        `structured node, children: ${childKeys.join(",")}`,
      );
      err.code = "STRUCTURED_NODE";
      throw err;
    }
    return "";
  }
  return "";
};

const getField = (obj, ...keys) => {
  for (const key of keys) {
    if (obj[key] !== undefined) return getText(obj[key]);
  }
  return "";
};

function detectEncoding(filePath) {
  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.alloc(2);
  fs.readSync(fd, buf, 0, 2, 0);
  fs.closeSync(fd);
  return buf[0] === 0xff && buf[1] === 0xfe ? "utf16le" : "utf8";
}

function createDecodedStream(filePath) {
  const encoding = detectEncoding(filePath);
  const fileStream = fs.createReadStream(filePath);
  if (encoding === "utf16le") {
    return fileStream.pipe(iconv.decodeStream("utf16le"));
  }
  return fileStream;
}

export async function ParceStoreFile(xmlpath) {
  const stats = {
    seen: 0,
    inserted: 0,
    skippedEmpty: 0,
    skippedStructured: 0,
    skippedBadPrice: 0,
    dbErrors: 0,
  };
  return new Promise((resolve, reject) => {
    const rawStream = createDecodedStream(xmlpath);
    const xmlStream = new XmlStream(rawStream);

    let currentChainId = null;
    let currentChainName = null;
    let currentSubChainId = null;
    let chainInserted = false;
    let loggedStructured = false;

    const safeGetText = (node, tag) => {
      try {
        return getText(node);
      } catch (e) {
        if (e.code === "STRUCTURED_NODE") {
          if (!loggedStructured) {
            loggedStructured = true;
            console.warn(
              `structured field <${tag}> in ${xmlpath}: ${e.message}`,
            );
          }
          return "";
        }
        throw e;
      }
    };

    console.log(` Starting store file parsing: ${xmlpath}`);

    const tryInsertChain = async () => {
      if (currentChainId && currentChainName && !chainInserted) {
        chainInserted = true;
        try {
          await db.query(
            "INSERT INTO app.chains (id, name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name",
            [currentChainId, currentChainName],
          );
          console.log(
            ` Inserted chain: ${currentChainId} - ${currentChainName}`,
          );
        } catch (e) {
          console.error("Error updating chain:", e.message);
        }
      }
    };

    for (const tag of ["ChainID", "ChainId", "CHAINID"]) {
      xmlStream.on(`endElement: ${tag}`, async (node) => {
        const val = safeGetText(node, tag);
        if (val && !currentChainId) {
          currentChainId = val;
          console.log(` Captured ChainID: ${currentChainId}`);
          rawStream.pause();
          await tryInsertChain();
          rawStream.resume();
        }
      });
    }

    for (const tag of ["ChainName", "CHAINNAME"]) {
      xmlStream.on(`endElement: ${tag}`, async (node) => {
        const val = safeGetText(node, tag);
        if (val && !currentChainName) {
          currentChainName = val;
          console.log(` Captured ChainName: ${currentChainName}`);
          rawStream.pause();
          await tryInsertChain();
          rawStream.resume();
        }
      });
    }

    for (const tag of ["SubChainID", "SubChainId", "SUBCHAINID"]) {
      xmlStream.on(`endElement: ${tag}`, (node) => {
        const val = safeGetText(node, tag);
        if (val) currentSubChainId = val;
      });
    }

    for (const tag of ["SubChainName", "SUBCHAINNAME"]) {
      xmlStream.on(`endElement: ${tag}`, async (node) => {
        rawStream.pause();
        const subChainName = safeGetText(node, tag);
        if (currentSubChainId && currentChainId) {
          try {
            await db.query(
              "INSERT INTO app.sub_chains (id, chain_id, name) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name",
              [currentSubChainId, currentChainId, subChainName],
            );
          } catch (e) {
            console.error("Error inserting sub-chain:", e.message);
          }
        }
        rawStream.resume();
      });
    }

    for (const tag of ["Store", "STORE"]) {
      xmlStream.on(`endElement: ${tag}`, async (store) => {
        rawStream.pause();
        try {
          const storeId = getField(store, "StoreID", "StoreId", "STOREID");
          const storeName = getField(store, "StoreName", "STORENAME");
          const address = getField(store, "Address", "ADDRESS");
          const city = getField(store, "City", "CITY");
          const subChainId =
            getField(store, "SubChainID", "SubChainId", "SUBCHAINID") ||
            currentSubChainId;

          const storeChainName = getField(store, "ChainName", "CHAINNAME");
          if (storeChainName && !currentChainName) {
            currentChainName = storeChainName;
            await tryInsertChain();
          }

          if (storeId && currentChainId) {
            await db.query(
              "INSERT INTO app.branches (id, chain_id, sub_chain_id, branch_name, address, city) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING",
              [
                storeId,
                currentChainId,
                subChainId || null,
                storeName,
                address,
                city,
              ],
            );
          }
        } catch (e) {
          console.error(`Error inserting branch:`, e);
        } finally {
          rawStream.resume();
        }
      });
    }

    xmlStream.on("end", async () => {
      console.log(" Finished processing branches file.");
      await movetoprocess(xmlpath);
      resolve();
    });

    xmlStream.on("error", (err) => reject(err));
  });
}

export async function parsePriceFile(xmlPath, branchId) {
  try {
    const branchCheck = await db.query(
      "SELECT 1 FROM app.branches WHERE id = $1",
      [branchId],
    );
    if (branchCheck.rowCount === 0) {
      console.warn(
        `Branch ${branchId} does not exist in database. Skipping price file ${xmlPath}`,
      );
      await movetoprocess(xmlPath);
      return;
    }
  } catch (e) {
    console.error(`Error checking branch existence for ${branchId}:`, e);
    return;
  }

  const stats = {
    seen: 0,
    inserted: 0,
    skippedEmpty: 0,
    skippedStructured: 0,
    skippedBadPrice: 0,
    dbErrors: 0,
  };

  const itemBuffer = [];

  await new Promise((resolve, reject) => {
    const rawStream = createDecodedStream(xmlPath);
    const xmlStream = new XmlStream(rawStream);
    console.log(` Starting price extraction for branch ${branchId}`);

    for (const tag of ["Item", "ITEM"]) {
      xmlStream.on(`endElement: ${tag}`, (item) => {
        itemBuffer.push(item);
      });
    }

    xmlStream.on("end", resolve);
    xmlStream.on("error", reject);
  });

  await asyncPool(20, itemBuffer, async (item) => {
    stats.seen++;
    try {
      let itemCode, itemName, price, manufacturer, unitQty;
      try {
        itemCode = getField(item, "ItemCode", "ITEMCODE");
        itemName = getField(item, "ItemName", "ItemNm", "ITEMNAME");
        const priceVal = item.ItemPrice || item.ITEMPRICE || item.itemPrice;
        price = parseFloat(
          typeof priceVal === "string" ? priceVal : getText(priceVal),
        );
        manufacturer =
          getField(
            item,
            "ManufacturerName",
            "ManufactureName",
            "MANUFACTURERNAME",
          ) || "לא ידוע";
        unitQty = getField(item, "UnitQty", "UNITQTY") || "1";
      } catch (e) {
        if (e.code === "STRUCTURED_NODE") {
          stats.skippedStructured++;
          if (stats.skippedStructured === 1) {
            console.warn(
              `structured field in ${xmlPath} (branch ${branchId}): ${e.message}`,
            );
          }
          return;
        }
        throw e;
      }

      if (!itemCode || !itemName) {
        stats.skippedEmpty++;
        return;
      }
      if (isNaN(price)) {
        stats.skippedBadPrice++;
        return;
      }

      const sqlQuery = `
        WITH ins_item AS (
          INSERT INTO app.items (barcode, item_code, name, manufacturer, unit_qty)
          VALUES ($1, $1, $2, $3, $4)
          ON CONFLICT (item_code, manufacturer, is_weighted) DO UPDATE SET
            name = EXCLUDED.name,
            unit_qty = EXCLUDED.unit_qty
          RETURNING id
        )
        INSERT INTO app.prices (item_id, branch_id, price, price_update_time)
        SELECT id, $5, $6, NOW() FROM ins_item
        ON CONFLICT (item_id, branch_id) DO UPDATE SET
          price = EXCLUDED.price,
          price_update_time = NOW();
      `;
      await db.query(sqlQuery, [
        itemCode,
        itemName,
        manufacturer,
        unitQty,
        branchId,
        price,
      ]);
      stats.inserted++;
    } catch (err) {
      stats.dbErrors++;
      if (stats.dbErrors <= 3) {
        console.error(` Error in item:`, err.message);
      }
    }
  });

  console.log(
    ` Price update for branch ${branchId} done: ${JSON.stringify(stats)}`,
  );
  if (stats.seen > 0 && stats.inserted / stats.seen < 0.9) {
    console.warn(
      `LOW INSERT RATE for ${xmlPath}: ${stats.inserted}/${stats.seen}`,
    );
  }
  await movetoprocess(xmlPath);
}
