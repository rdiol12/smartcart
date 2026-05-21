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

    // A push token uniquely identifies a device install. If we see this
    // token already registered to a different user, log it loudly: that's
    // either a legitimate re-login on a shared device, or an attacker who
    // got hold of someone else's Expo token registering it on their own
    // account to hijack notifications. The upsert still goes through (so
    // the legit case keeps working) but the audit trail is recoverable
    // from the warn log.
    const existing = await db.query(
      "SELECT user_id FROM app.push_tokens WHERE token = $1",
      [token],
    );
    const prior = existing.rows[0]?.user_id;
    if (prior && prior !== userId) {
      logger.warn("Push token ownership transferred", {
        priorUserId: prior,
        newUserId: userId,
        tokenPrefix: String(token).slice(0, 24),
      });
    }

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
