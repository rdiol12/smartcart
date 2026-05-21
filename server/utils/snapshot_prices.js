import pg from "pg";
import { config } from "dotenv";
import { logger } from "./logger.js";

/**
 * Snapshot current prices into price_history and prune rows older
 * than 90 days. Takes a pg-compatible client/pool (the shared one
 * when run from the cron in server.js, a throwaway pool when run as
 * a CLI script). Never calls db.end() — callers own the pool lifecycle.
 */
async function snapshotPrices(db) {
  logger.info("[Price Snapshot] Running daily price snapshot");

  const result = await db.query(`
    INSERT INTO app.price_history (product_id, chain_id, price, recorded_at)
    SELECT
      p.item_id as product_id,
      b.chain_id,
      p.price,
      NOW() as recorded_at
    FROM app.prices p
    JOIN app.branches b ON b.id = p.branch_id
    WHERE p.price IS NOT NULL
    ON CONFLICT DO NOTHING
    RETURNING id
  `);
  const inserted = result.rowCount || 0;
  logger.info(`[Price Snapshot] Inserted ${inserted} price records`);

  const cleanupResult = await db.query(`
    DELETE FROM app.price_history
    WHERE recorded_at < NOW() - INTERVAL '90 days'
    RETURNING id
  `);
  const cleaned = cleanupResult.rowCount || 0;
  logger.info(`[Price Snapshot] Cleaned up ${cleaned} old records (>90 days)`);

  return { inserted, cleaned };
}

// CLI entrypoint: create our own pool, run once, close pool.
if (import.meta.url === `file://${process.argv[1]}`) {
  config();
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  snapshotPrices(pool)
    .then(({ inserted, cleaned }) => {
      logger.info(
        `[Price Snapshot] Done. Inserted: ${inserted}, Cleaned: ${cleaned}`,
      );
      return pool.end();
    })
    .then(() => process.exit(0))
    .catch(async (err) => {
      logger.error("[Price Snapshot] Fatal error", { error: err.message });
      await pool.end().catch(() => {});
      process.exit(1);
    });
}

export default snapshotPrices;
