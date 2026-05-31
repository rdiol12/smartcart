import db from "./db.js";
import { logger } from "./logger.js";

const GRACE_SECONDS = 60;
const SWEEP_INTERVAL_MS = 5 * 60_000; // run every 5 min
const SWEEP_RETAIN_INTERVAL = "10 minutes";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if token was rotated recently (grace window)
 */
export async function wasRecentlyRotated(oldTokenId) {
  const { rows } = await db.query(
    `SELECT 1
     FROM app2.refresh_rotations
     WHERE old_token_id = $1
       AND rotated_at > NOW() - ($2::int * INTERVAL '1 second')`,
    [oldTokenId, GRACE_SECONDS],
  );

  return rows.length > 0;
}

/**
 * Record successful rotation
 */
export async function recordRotation(oldTokenId) {
  await db.query(
    `INSERT INTO app2.refresh_rotations (old_token_id, rotated_at)
     VALUES ($1, NOW())
     ON CONFLICT (old_token_id) DO NOTHING`,
    [oldTokenId],
  );
}

/**
 * Background cleanup job (RUNS ONCE PER PROCESS)
 * Returns a stop function for graceful shutdown.
 */
let sweepStarted = false;

export function startRefreshRotationSweep() {
  if (sweepStarted) return () => {};
  sweepStarted = true;

  let stopped = false;

  const run = async () => {
    while (!stopped) {
      try {
        const result = await db.query(
          `DELETE FROM app2.refresh_rotations
           WHERE rotated_at < NOW() - ($1::interval)`,
          [SWEEP_RETAIN_INTERVAL],
        );

        if (result.rowCount > 0) {
          logger.info("Refresh rotation sweep deleted stale rows", {
            rowCount: result.rowCount,
          });
        }
      } catch (err) {
        logger.error("Refresh rotation sweep error", {
          message: err?.message,
          code: err?.code,
          stack: err?.stack,
        });
      }

      await sleep(SWEEP_INTERVAL_MS);
    }
  };

  const runWithRestart = async () => {
    while (!stopped) {
      try {
        await run();
      } catch (err) {
        logger.error("Sweep crashed, restarting in 60s", {
          message: err?.message,
          stack: err?.stack,
        });
        await sleep(60_000);
      }
    }
  };

  runWithRestart();

  return () => {
    stopped = true;
  };
}
