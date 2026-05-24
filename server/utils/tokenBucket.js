import db from "../utils/db.js";
import { logger } from "../utils/logger.js";

// Defaults match previous in-memory settings; can be overridden by env if desired.
const SOCKET_RATE_PER_SEC = Number(process.env.SOCKET_RATE_PER_SEC) || 20;
const SOCKET_RATE_BURST = Number(process.env.SOCKET_RATE_BURST) || 50;

// Clean up buckets not touched in this many milliseconds (30 minutes)
const BUCKET_TTL_MS = 30 * 60 * 1000;

export async function rateLimitOk(userId) {
  const client = await db.connect();
  try {
    const res = await client.query(
      `WITH refilled AS (
     SELECT LEAST($2::numeric,
       COALESCE(
         tokens + EXTRACT(EPOCH FROM (now() - last_refill)) * $3,
         $2::numeric
       )
     ) AS val
     FROM app.socket_rate_buckets
     WHERE user_id = $1
   )
   INSERT INTO app.socket_rate_buckets (user_id, tokens, last_refill)
   VALUES ($1, $2::numeric - 1, now())
   ON CONFLICT (user_id) DO UPDATE SET
     tokens      = (SELECT val FROM refilled) - 1,
     last_refill = now()
   -- WHERE false = insufficient tokens; RETURNING emits no row, rowCount = 0
   WHERE (SELECT val FROM refilled) >= 1
   RETURNING tokens`,
      [userId, SOCKET_RATE_BURST, SOCKET_RATE_PER_SEC],
    );

    return res.rowCount > 0;
  } catch (err) {
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
