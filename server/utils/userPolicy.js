import db from "./db.js";

/**
 * Verify the user exists and is not a child account. Throws with
 * err.code = "USER_NOT_FOUND" or "IS_CHILD" so callers can map cleanly
 * to user-facing responses. Single source of truth for the rule, so
 * the REST and socket paths can't drift.
 */
export async function assertNotChild(userId) {
  const res = await db.query(
    "SELECT parent_id FROM app2.users WHERE id = $1",
    [userId],
  );
  if (res.rows.length === 0) {
    const err = new Error("User not found");
    err.code = "USER_NOT_FOUND";
    throw err;
  }
  if (res.rows[0].parent_id !== null) {
    const err = new Error("Child accounts cannot perform this action");
    err.code = "IS_CHILD";
    throw err;
  }
}
