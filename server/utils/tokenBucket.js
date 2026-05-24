import db from "../utils/db.js";
import { logger } from "../utils/logger.js";

// Defaults match previous in-memory settings; can be overridden by env if desired.
const SOCKET_RATE_PER_SEC = Number(process.env.SOCKET_RATE_PER_SEC) || 20;
const SOCKET_RATE_BURST = Number(process.env.SOCKET_RATE_BURST) || 50;

// Clean up buckets not touched in this many milliseconds (30 minutes)
const BUCKET_TTL_MS = 30 * 60 * 1000;

export async function rateLimitOk(userId) {
  const nowMs = Date.now();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query(
      `INSERT INTO app.socket_rate_buckets (user_id, tokens, last_refill)
       VALUES ($1, $2, to_timestamp($3 / 1000.0))
       ON CONFLICT (user_id) DO UPDATE SET
         tokens = LEAST(
           $2,
           app.socket_rate_buckets.tokens + (
             EXTRACT(EPOCH FROM (now() - app.socket_rate_buckets.last_refill)) * $4
           )
         ),
         last_refill = now()
       RETURNING tokens`,
      [userId, SOCKET_RATE_BURST, nowMs, SOCKET_RATE_PER_SEC],
    );

    const tokens = parseFloat(res.rows[0].tokens);
    if (tokens < 1) {
      await client.query("COMMIT");
      return false;
    }

    await client.query(
      "UPDATE app.socket_rate_buckets SET tokens = tokens - 1 WHERE user_id = $1",
      [userId],
    );
    await client.query("COMMIT");
    return true;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_e) {}
    logger.error("Token bucket DB error", { error: err.message });
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
