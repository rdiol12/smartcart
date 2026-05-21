import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";
import db from "../utils/db.js";

const router = Router();
router.use(authenticateToken);

router.get("/api/activity/feed", async (req, res) => {
  const userId = req.userId;
  const { action, from, to, limit = 50, offset = 0 } = req.query;
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
      [
        userId,
        action || null,
        from || null,
        to || null,
        parseInt(limit),
        parseInt(offset),
      ],
    );
    return res.json({ activities: result.rows });
  } catch (err) {
    logger.error("Error fetching activity feed", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Error fetching activity feed" });
  }
});

export default router;
