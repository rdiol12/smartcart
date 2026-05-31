import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";
import db from "../utils/db.js";

const router = Router();
router.use(authenticateToken);

// Cache for push tokens (optional, for rate limiting)
const tokenOperationCache = new Map();
const CACHE_TTL = 1000; // 1 second cooldown for same token operations

const isRateLimited = (userId, token, operation) => {
  const key = `${userId}_${token}_${operation}`;
  const cached = tokenOperationCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return true;
  }
  tokenOperationCache.set(key, { timestamp: Date.now() });
  return false;
};

/**
 * POST /api/push-tokens
 * Register or update a push token for the authenticated user
 * Body: { token, platform }
 */
router.post("/", async (req, res) => {
  const { token, platform } = req.body;

  if (!token) {
    return res.status(400).json({ message: "Token required" });
  }

  // Validate platform (optional)
  const validPlatforms = ["android", "ios", "web"];
  const normalizedPlatform = platform?.toLowerCase();
  if (platform && !validPlatforms.includes(normalizedPlatform)) {
    return res.status(400).json({
      message: "Invalid platform. Must be android, ios, or web",
    });
  }

  // Rate limit to prevent abuse
  if (isRateLimited(req.userId, token, "register")) {
    return res
      .status(429)
      .json({ message: "Too many requests, please slow down" });
  }

  try {
    const userId = req.userId;

    // Check if token is already registered to a different user
    const existing = await db.query(
      "SELECT user_id, platform FROM app.push_tokens WHERE token = $1",
      [token],
    );
    const prior = existing.rows[0]?.user_id;
    const priorPlatform = existing.rows[0]?.platform;

    if (prior && prior !== userId) {
      logger.warn("Push token ownership transferred", {
        priorUserId: prior,
        newUserId: userId,
        tokenPrefix: String(token).slice(0, 24),
        platform: platform || "unknown",
      });
    }

    // Check if user already has too many tokens (optional limit)
    const tokenCount = await db.query(
      "SELECT COUNT(*) FROM app.push_tokens WHERE user_id = $1",
      [userId],
    );

    const MAX_TOKENS_PER_USER = 10;
    if (parseInt(tokenCount.rows[0].count) >= MAX_TOKENS_PER_USER && !prior) {
      // Remove oldest token for this user
      await db.query(
        `DELETE FROM app.push_tokens 
         WHERE id IN (
           SELECT id FROM app.push_tokens 
           WHERE user_id = $1 
           ORDER BY created_at ASC 
           LIMIT 1
         )`,
        [userId],
      );
      logger.info("Removed oldest token for user", {
        userId,
        tokenCount: tokenCount.rows[0].count,
      });
    }

    // Upsert token
    await db.query(
      `INSERT INTO app.push_tokens (user_id, token, platform, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (token) 
       DO UPDATE SET 
         user_id = $1, 
         platform = $3,
         updated_at = NOW()
       RETURNING id`,
      [userId, token, normalizedPlatform || "android"],
    );

    logger.debug("Push token saved", {
      userId,
      tokenPrefix: String(token).slice(0, 24),
      platform: normalizedPlatform || "android",
      transferred: !!(prior && prior !== userId),
    });

    return res.json({
      success: true,
      message:
        prior && prior !== userId
          ? "Token transferred to your account"
          : "Token registered successfully",
    });
  } catch (err) {
    logger.error("Error saving push token", {
      error: err.message,
      stack: err.stack,
      userId: req.userId,
    });
    return res.status(500).json({ message: "Error saving token" });
  }
});

/**
 * DELETE /api/push-tokens
 * Remove a push token for the authenticated user
 * Body: { token }
 */
router.delete("/", async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ message: "Token required" });
  }

  // Rate limit to prevent abuse
  if (isRateLimited(req.userId, token, "unregister")) {
    return res
      .status(429)
      .json({ message: "Too many requests, please slow down" });
  }

  try {
    const userId = req.userId;

    const result = await db.query(
      "DELETE FROM app.push_tokens WHERE token = $1 AND user_id = $2 RETURNING id",
      [token, userId],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Token not found for this user" });
    }

    logger.debug("Push token removed", {
      userId,
      tokenPrefix: String(token).slice(0, 24),
    });

    return res.json({ success: true, message: "Token removed successfully" });
  } catch (err) {
    logger.error("Error removing push token", {
      error: err.message,
      stack: err.stack,
      userId: req.userId,
    });
    return res.status(500).json({ message: "Error removing token" });
  }
});

/**
 * GET /api/push-tokens
 * Get all push tokens for the authenticated user (optional endpoint)
 */
router.get("/", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT token, platform, created_at, updated_at
       FROM app.push_tokens
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.userId],
    );

    return res.json({
      tokens: result.rows.map((row) => ({
        token: row.token,
        platform: row.platform,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (err) {
    logger.error("Error fetching push tokens", {
      error: err.message,
      stack: err.stack,
      userId: req.userId,
    });
    return res.status(500).json({ message: "Error fetching tokens" });
  }
});

/**
 * DELETE /api/push-tokens/all
 * Remove all push tokens for the authenticated user (logout all devices)
 */
router.delete("/all", async (req, res) => {
  try {
    const result = await db.query(
      "DELETE FROM app.push_tokens WHERE user_id = $1 RETURNING id",
      [req.userId],
    );

    logger.info("All push tokens removed for user", {
      userId: req.userId,
      count: result.rowCount,
    });

    return res.json({
      success: true,
      message: `Removed ${result.rowCount} token(s)`,
    });
  } catch (err) {
    logger.error("Error removing all push tokens", {
      error: err.message,
      stack: err.stack,
      userId: req.userId,
    });
    return res.status(500).json({ message: "Error removing tokens" });
  }
});

// Clean up old token operation cache periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of tokenOperationCache.entries()) {
    if (now - value.timestamp >= CACHE_TTL) {
      tokenOperationCache.delete(key);
    }
  }
}, 60 * 1000); // Clean up every minute

export default router;
