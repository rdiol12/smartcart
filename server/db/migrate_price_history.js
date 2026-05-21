import pg from 'pg';
import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '..', '.env') });

const { Pool } = pg;
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function migrate() {
  try {
    const sql = readFileSync(join(__dirname, 'add_price_history.sql'), 'utf8');

    // Naive split — fine for the simple DDL in add_price_history.sql (a few
    // CREATE TABLE / CREATE INDEX IF NOT EXISTS statements with no embedded
    // semicolons), but it WILL choke on anything containing a ';' inside a
    // string literal, function body ($$...$$), comment, or DO block. If the
    // companion SQL file ever grows beyond trivial DDL, swap to a real SQL
    // parser (e.g. pg-minify or sending the whole file as one statement
    // since pg supports multi-statement queries).
    const statements = sql.split(';').filter((s) => s.trim());

    for (const statement of statements) {
      if (statement.trim()) {
        await db.query(statement);
        console.log(' Executed:', statement.substring(0, 60) + '...');
      }
    }
    
    console.log(' Migration completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error(' Migration failed:', err.message);
    process.exit(1);
  }
}

migrate();
