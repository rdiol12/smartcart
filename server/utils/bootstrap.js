import db from "./db.js";
import { logger } from "./logger.js";

/**
 * Idempotent runtime schema setup for tables that hold transient security
 * state (login lockouts, refresh-token rotation history). Keeping these in
 * the DB instead of in-process memory means they survive restarts and
 * work across horizontally-scaled instances.
 */
export async function ensureSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS app2.login_attempts (
      identifier TEXT PRIMARY KEY,
      count INT NOT NULL DEFAULT 0,
      first_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      locked_until TIMESTAMPTZ
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS app2.refresh_rotations (
      old_token_id BIGINT PRIMARY KEY,
      rotated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_refresh_rotations_rotated_at
      ON app2.refresh_rotations (rotated_at)
  `);
  logger.info("Schema bootstrap complete");
}
