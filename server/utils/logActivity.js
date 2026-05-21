import db from "./db.js";
import { logger } from "./logger.js";

async function logActivity(listId, userId, action, details) {
  try {
    await db.query(
      `INSERT INTO app.activity_log (list_id, user_id, action, details) VALUES ($1, $2, $3, $4)`,
      [listId, userId, action, details],
    );
  } catch (err) {
    logger.error("Error logging activity", { error: err.message, stack: err.stack });
  }
}

export default logActivity;
