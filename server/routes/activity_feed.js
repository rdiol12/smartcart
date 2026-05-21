import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";
import db from "../utils/db.js";

const router = Router();
router.use(authenticateToken);

// Mounted at "/api/activity/feed" in server.js, so the route inside the
// router is just "/". Previously this was also "/api/activity/feed", which
// concatenated to "/api/activity/feed/api/activity/feed" — i.e. nothing on
// the public surface ever reached this handler.
router.get("/", async (req, res) => {
  const userId = req.userId;
  const { action, from, to } = req.query;
  // Always parse with explicit radix and cap. Default 50, hard ceiling 100;
  // a caller passing ?limit=999999999 used to be honored, which both OOMs
  // the response and lets an attacker scrape the activity log cheaply.
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  try {
    const result = await db.query(
      `SELECT al.id, al.list_id, al.user_id, al.action, al.details, al.created_at,
              u.first_name AS user_name,
              l.list_name
       FROM app.activity_log al
       JOIN app.list_members lm ON lm.list_id = al.list_id AND lm.user_id = $1
       LEFT JOIN app2.users u ON al.user_id = u.id
       LEFT JOIN app.list l ON al.list_id = l.id
       WHERE ($2::VARCHAR IS NULL OR al.action = $2)
         AND ($3::TIMESTAMPTZ IS NULL OR al.created_at >= $3::TIMESTAMPTZ)
         AND ($4::TIMESTAMPTZ IS NULL OR al.created_at <= $4::TIMESTAMPTZ)
       ORDER BY al.created_at DESC
       LIMIT $5 OFFSET $6`,
      [userId, action || null, from || null, to || null, limit, offset],
    );
    return res.json({ activities: result.rows });
  } catch (err) {
    logger.error("Error fetching activity feed", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Error fetching activity feed" });
  }
});

export default router;
