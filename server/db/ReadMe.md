server/db/ — operational scripts

This folder is not part of the running server. Nothing here is imported by server.js or any route. These are one-off CLI tools you run by hand (or from a shell script) against the database — typically locally, sometimes against production. Each one needs DATABASE_URL to be set in server/.env (which the scripts load themselves; they do not go through utils/env.js).

Run any of them with:

node server/db/<script>.js
Script	What it does	Touches data?	Idempotent?
parser.js	XML parser for Israeli supermarket price feeds (chains/branches/items/prices). Exports ParceStoreFile and parsePriceFile. Not a standalone entrypoint — called by sortfolder.js.	Writes	No
sortfolder.js	Walks one chain's folder under server/my_prices/<chain>/, runs parser.js against every Stores*.xml and Price*.xml file, then moves processed files into <chain>/process/.	Writes	No
run-parser.js	Top-level entrypoint that calls sortfolder.js for every chain folder under server/my_prices/. This is the script you actually invoke for ingestion.	Writes	No
organizefiles.js	Helper used by sortfolder.js to move a finished file into the sibling process/ directory. Not standalone.	No (DB)	Yes
add_price_history.sql	One-time DDL: creates app.price_history and its indexes if missing. Run via migrate_price_history.js.	Schema	Yes (IF NOT EXISTS)
migrate_price_history.js	Runs the statements in add_price_history.sql against DATABASE_URL. Only needed when upgrading a database that pre-dates app.price_history being in db_init/init.sql — fresh installs already create the table via the docker-compose init mount.	Schema	Yes
Notes

Safe to run against production? parser.js / sortfolder.js / run-parser.js write large volumes of price rows — they're for the ingestion path, not "tools to run against prod for debugging."
Where does the data go? Ingestion expects unzipped XML feeds under server/my_prices/<chain-name>/. The XML files are gitignored.
Why a separate pool? These scripts run as standalone CLI processes — not inside the server. They each create their own pg.Pool via the createPool() factory in utils/db.js so they share connection config with the server without coupling lifecycles.
Backups / dumps

For exporting the database, use pg_dump directly. There used to be three hand-rolled exporters here (export-database.js, export-simple.js, export-stream.js); they were deleted because they were all broken:

export-database.js referenced pg_attrdef.adsrc, which Postgres dropped in version 12 (we're on 16). Threw on the first table it tried.
export-stream.js started by reading a ../../deploy.sql file that doesn't exist anywhere in the repo. ENOENT on import.
All three hardcoded a table list that included the dead app.list_users table and was missing every newer table (list_chat, push_tokens, price_alerts, activity_log, price_history, login_attempts, refresh_rotations, etc.) — so even if they had run, the dump would have been silently incomplete.
The correct invocation is:

pg_dump -h "$HOST" -U "$USER" -n app -n app2 "$DB" > smartcart_dump.sql
pg_dump is shipped with Postgres, handles schema introspection correctly, streams to disk, and stays in sync with the database structure for free.