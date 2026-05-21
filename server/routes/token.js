import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";
import db from "../utils/db.js";

const router = Router();
router.use(authenticateToken);

// Push token management
router.post("/", async (req, res) => {
  const { token, platform } = req.body;
  if (!token) return res.status(400).json({ message: "Token required" });
  try {
    const userId = req.userId;
    await db.query(
      `INSERT INTO app.push_tokens (user_id, token, platform)
       VALUES ($1, $2, $3)
       ON CONFLICT (token) DO UPDATE SET user_id = $1, platform = $3`,
      [userId, token, platform || "android"],
    );
    return res.json({ success: true });
  } catch (err) {
    logger.error("Error saving push token", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Error saving token" });
  }
});

router.delete("/", async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ message: "Token required" });
  try {
    const userId = req.userId;
    await db.query(
      "DELETE FROM app.push_tokens WHERE token = $1 AND user_id = $2",
      [token, userId],
    );
    return res.json({ success: true });
  } catch (err) {
    logger.error("Error removing push token", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Error removing token" });
  }
});

export default router;
