import db from "../utils/db.js";
import assertMember from "../utils/assertmember.js";
import { assertNotChild } from "../utils/userPolicy.js";

/**
 * Bulk-update sort_order for a set of items on a list. Single `UPDATE … FROM
 * (VALUES …)` instead of N sequential UPDATEs in a transaction — same
 * atomicity (one statement), one round-trip. Shared between the REST
 * PUT /:id/reorder route and the socket reorder_items handler, both of
 * which used to inline the same logic separately.
 */
export async function reorderItems({ listId, userId, items }) {
  await assertMember(listId, userId);
  if (!items.length) return;

  const valuesSql = items
    .map((_, i) => `($${i * 2 + 2}::int, $${i * 2 + 3}::int)`)
    .join(", ");
  const params = [listId];
  for (const item of items) {
    params.push(item.itemId, item.sortOrder);
  }
  await db.query(
    `UPDATE app.list_items AS li
     SET sort_order = v.sort_order
     FROM (VALUES ${valuesSql}) AS v(item_id, sort_order)
     WHERE li.id = v.item_id AND li.listid = $1`,
    params,
  );
}

/**
 * Insert an item into a list. Single source of truth for the rule + SQL
 * shared between the REST route POST /api/lists/:id/items and the socket
 * send_item handler. Throws on policy violations (assertMember /
 * assertNotChild error codes); callers map those to their transport's
 * response shape (HTTP status vs socket emit).
 *
 * Returns { newItem, adderName } — newItem is the inserted row,
 * adderName is the first_name of the user who added it (for push
 * notifications). sort_order is always set to the next slot in the list
 * so drag-and-drop reordering behaves consistently regardless of which
 * path created the item.
 */
export async function addItem({
  listId,
  userId,
  itemName,
  price = null,
  storeName = null,
  quantity = 1,
  productId = null,
}) {
  await assertMember(listId, userId);
  await assertNotChild(userId);

  const result = await db.query(
    `WITH inserted AS (
       INSERT INTO app.list_items
         (listid, itemname, price, storename, quantity, addby, addat, updatedat, product_id, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), $7,
               COALESCE((SELECT MAX(sort_order) FROM app.list_items WHERE listid = $1), 0) + 1)
       RETURNING *
     )
     SELECT inserted.*, u.first_name AS adder_name
       FROM inserted
       LEFT JOIN app2.users u ON u.id = $6`,
    [listId, itemName, price, storeName, quantity, userId, productId],
  );

  // assertNotChild above guarantees the user exists, but if it ever gets
  // refactored away the INNER JOIN would silently return zero rows after a
  // successful INSERT and crash destructuring. LEFT JOIN + explicit guard
  // turns that into a clean error.
  if (result.rows.length === 0) {
    throw new Error("Item inserted but row lookup returned no result");
  }
  const { adder_name: adderName, ...newItem } = result.rows[0];
  return { newItem, adderName };
}
