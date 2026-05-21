import db from "../utils/db.js";
import assertMember from "../utils/assertmember.js";
import { assertNotChild } from "../utils/userPolicy.js";

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
       JOIN app2.users u ON u.id = $6`,
    [listId, itemName, price, storeName, quantity, userId, productId],
  );

  const { adder_name: adderName, ...newItem } = result.rows[0];
  return { newItem, adderName };
}
