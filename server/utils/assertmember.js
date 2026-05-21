import db from "../utils/db.js";

async function assertMember(listId, userId) {
  const result = await db.query(
    "SELECT 1 FROM app.list_members WHERE list_id = $1 AND user_id = $2",
    [listId, userId],
  );
  if (result.rows.length === 0) throw new Error("Not a member");
}

export default assertMember;
