import db from "./db.js";
import { logger } from "./logger.js";
import { PostgresStore } from "@acpr/rate-limit-postgresql";

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

  try {
    await db.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    await db.query(
      `CREATE INDEX IF NOT EXISTS idx_items_name_trgm
         ON app.items USING GIN (name gin_trgm_ops)`,
    );
  } catch (err) {
    logger.warn("pg_trgm index skipped", { error: err.message });
  }

  try {
    await db.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_price_history_per_snapshot
         ON app.price_history (product_id, chain_id, recorded_at)`,
    );
  } catch (err) {
    logger.warn("price_history unique index skipped", { error: err.message });
  }

  await db.query(
    `ALTER TABLE app.items ADD COLUMN IF NOT EXISTS image_url VARCHAR(500)`,
  );

  try {
    const dbConfig = { connectionString: process.env.DATABASE_URL };
    new PostgresStore(dbConfig, "rate_limit_init");
    // Give it a moment to run migrations
    await new Promise((resolve) => setTimeout(resolve, 2000));
    logger.info("Rate limit schema migrated");
  } catch (err) {
    logger.warn("Rate limit migration skipped", { error: err.message });
  }

  logger.info("Schema bootstrap complete");
}
