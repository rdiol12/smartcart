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

  // Trigram index for ILIKE '%term%' product search. Without this, every
  // /api/search query sequentially scans app.items — fine on a dev dataset,
  // catastrophic on a real Israeli grocery catalog. CREATE EXTENSION needs
  // CREATEROLE/SUPERUSER which most managed PGs grant to the owning role; if
  // it fails (e.g. tighter perms) we log and continue — the server still
  // works, search just stays slow.
  try {
    await db.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    await db.query(
      `CREATE INDEX IF NOT EXISTS idx_items_name_trgm
         ON app.items USING GIN (name gin_trgm_ops)`,
    );
  } catch (err) {
    logger.warn("pg_trgm index skipped", { error: err.message });
  }

  // Idempotency guard for the daily price snapshot. snapshot_prices.js's
  // INSERT now specifies ON CONFLICT (product_id, chain_id, recorded_at) —
  // without this unique index the conflict target has nothing to match and
  // the query throws. If the index can't be created (existing duplicates,
  // for example), log loudly so the operator knows the snapshot will be
  // unprotected against double runs.
  try {
    await db.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_price_history_per_snapshot
         ON app.price_history (product_id, chain_id, recorded_at)`,
    );
  } catch (err) {
    logger.warn("price_history unique index skipped", { error: err.message });
  }

  // app.items.image_url missing from init.sql; barcode endpoint selects it.
  await db.query(
    `ALTER TABLE app.items ADD COLUMN IF NOT EXISTS image_url VARCHAR(500)`,
  );

  logger.info("Schema bootstrap complete");
}
