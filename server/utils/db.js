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
  return new Pool({ connectionString: process.env.DATABASE_URL });
}

export const db = createPool();

db.on("error", (err) => {
  logger.error("Unexpected database error", { error: err.message });
});

export default db;
