import pg from "pg";
import { logger } from "./logger.js";

const { Pool } = pg;

/**
 * Build a fresh pg.Pool from process.env.DATABASE_URL. The server uses the
 * default export below for its long-lived pool; CLI scripts (e.g. parser.js)
 * call this to get their own short-lived pool with the same config. Centralizes
 * connection settings so they only need to be changed in one place.
 */
export function createPool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    // Default pg.Pool max is 10 — easy to exhaust under socket-event bursts
    // (each REST handler holds a client for the duration of one query, but
    // io.emit fanouts can trigger several concurrent reads from the same
    // user). 20 gives headroom; bump higher if the deploy starts queueing.
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // SSL is controlled by sslmode= in DATABASE_URL (managed PGs like Neon
    // / Render bake `sslmode=require` into the URL they hand out). If you
    // ever need to force/relax SSL, add an `ssl` option here.
  });
}

export const db = createPool();

db.on("error", (err) => {
  logger.error("Unexpected database error", { error: err.message });
});

export default db;
