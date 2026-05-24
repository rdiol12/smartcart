import db from "../utils/db.js";
import { logger } from "../utils/logger.js";

// Defaults match previous in-memory settings; can be overridden by env if desired.
const SOCKET_RATE_PER_SEC = Number(process.env.SOCKET_RATE_PER_SEC) || 20;
const SOCKET_RATE_BURST = Number(process.env.SOCKET_RATE_BURST) || 50;

// Clean up buckets not touched in this many milliseconds (30 minutes)
const BUCKET_TTL_MS = 30 * 60 * 1000;

export async function rateLimitOk(userId) {
  const nowMs = Date.now();
  const client = await db.getClient();
  try {
    await client.query("BEGIN");
    const res = await client.query(
      "SELECT tokens, last_refill FROM app.socket_rate_buckets WHERE user_id = $1 FOR UPDATE",
      [userId],
    );

    if (res.rows.length === 0) {
      // New bucket: give full burst minus one token for this request
      await client.query(
        "INSERT INTO app.socket_rate_buckets (user_id, tokens, last_refill) VALUES ($1, $2, to_timestamp($3 / 1000.0))",
        [userId, SOCKET_RATE_BURST - 1, nowMs],
      );
      await client.query("COMMIT");
      return true;
    }

    const row = res.rows[0];
    const lastRefillMs = new Date(row.last_refill).getTime();
    let tokens = parseFloat(row.tokens);
    const elapsed = (nowMs - lastRefillMs) / 1000.0;
    tokens = Math.min(
      SOCKET_RATE_BURST,
      tokens + elapsed * SOCKET_RATE_PER_SEC,
    );
    if (tokens < 1) {
      // Persist updated tokens and last_refill
      await client.query(
        "UPDATE app.socket_rate_buckets SET tokens = $1, last_refill = to_timestamp($2 / 1000.0) WHERE user_id = $3",
        [tokens, nowMs, userId],
      );
      await client.query("COMMIT");
      return false;
    }

    tokens -= 1;
    await client.query(
      "UPDATE app.socket_rate_buckets SET tokens = $1, last_refill = to_timestamp($2 / 1000.0) WHERE user_id = $3",
      [tokens, nowMs, userId],
    );
    await client.query("COMMIT");
    return true;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_e) {}
    logger.error("Token bucket DB error", { error: err.message });
    // On DB errors, fail open to avoid blocking legitimate traffic.
    return true;
  } finally {
    client.release();
  }
}

// Periodic cleanup of stale buckets to avoid table growth.
setInterval(
  async () => {
    try {
      const cutoff = new Date(Date.now() - BUCKET_TTL_MS).toISOString();
      const { rowCount } = await db.query(
        "DELETE FROM app.socket_rate_buckets WHERE last_refill < $1",
        [cutoff],
      );
      if (rowCount > 0)
        logger.info("Pruned socket rate buckets", { count: rowCount });
    } catch (err) {
      logger.error("Error pruning socket rate buckets", { error: err.message });
    }
  },
  5 * 60 * 1000,
).unref?.();
