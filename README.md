## Deployment Notes

The backend is hosted on Render's free tier, which spins down after 
15 minutes of inactivity. The first request after idle may take up to 
60 seconds while the server cold-starts. Subsequent requests are normal speed.
the issing token alert is expected refresh after 60s and it should work


# SmartCart

A collaborative shopping-list app backed by a live feed of Israeli supermarket prices.

Users build shared lists with their family or friends; the app shows the current price of each item across nearby branches, so the list doubles as a price comparison and budgeting tool. Behind the scenes, a crawler ingests the public XML price feeds that Israeli supermarket chains are required to publish, a streaming parser pushes them into Postgres, and the frontend reads from there in real time.

## Features

- **Shared shopping lists** with realtime updates via Socket.io (add, check off, comment, assign payer).
- **Live prices across chains**, pulled from each chain's public XML feed and normalised into a single schema.
- **Barcode scanning** in the browser (camera → item lookup).
- **Family accounts** — parents can review and approve item requests from linked child accounts.
- **Price alerts** — set a threshold on an item and get notified when any branch crosses it.
- **Push notifications** for shared list activity.

## Stack

| Layer    | Tech                                                       |
| -------- | ---------------------------------------------------------- |
| Frontend | React 19 + Vite, React Router, Socket.io-client, Chart.js  |
| Backend  | Node.js (ESM) + Express, Socket.io, JWT auth, Resend email |
| Database | PostgreSQL 16                                              |
| Ingest   | `xml-stream-saxjs` streaming parser, Docker-based crawler  |
| Infra    | Docker Compose (Postgres + pgAdmin + server + frontend)    |

## Architecture

```
┌─────────────┐    ┌─────────────────┐    ┌──────────────┐
│  React UI   │◄──►│ Express + WS    │◄──►│  Postgres    │
│  (frontend) │    │  (server)       │    │  app schema  │
└─────────────┘    └────────▲────────┘    └──────▲───────┘
                            │                     │
                            │            ┌────────┴────────┐
                            │            │  parser.js      │
                            │            │  (XML → SQL)    │
                            │            └────────▲────────┘
                            │                     │
                            │            ┌────────┴────────┐
                            │            │ crawler.sh      │
                            │            │ (Docker scraper)│
                            │            └─────────────────┘
                            │
                       JWT / Socket.io
```

The data pipeline runs out-of-band from the API: `crawler.sh` downloads XML dumps from chain portals into `server/my_prices/<Chain>/`, then `node db/run-parser.js` walks those folders, streams each `PriceFull*.xml` through `parser.js`, and upserts items + prices into the `app` schema.

### Database layout

The DB is split across two schemas:

- **`app`** — domain data the price pipeline owns. `items`, `prices`, `branches`, `chains`, `list`, `list_items`, `list_members`, `list_invites`, `list_chat`, `list_item_comments`, `activity_log`, `price_alerts`, `price_history`, `push_tokens`, `list_templates`, `template_items`.
- **`app2`** — identity / auth state. `users`, `tokens`, `kid_requests`, `login_attempts`, `refresh_rotations`.

The split is historical (auth tables were added after the price-feed schema was already in production) and most joins cross the boundary (`app.list_items JOIN app2.users`). It works, but every new query has to remember which schema each table lives in. Collapsing into one schema is on the long-term cleanup list.

**Column naming in `app.list_items`** is inconsistent for historical reasons: the older columns (`addby`, `addat`, `updatedat`) are run-together identifiers, while newer ones (`paid_by`, `paid_at`, `note_by`, `checked_by`, `assigned_to`) use snake_case underscores. The DDL declares some of the older columns with mixed case (`listId`, `itemName`, `storeName`), but Postgres folds unquoted identifiers to lowercase so on disk and in every query they're just `listid`, `itemname`, `storename` — the mixed-case DDL is a lie. A rename is a multi-table migration plus a frontend pass, so for now: when adding a new column, use snake_case and reference the existing inconsistency in code review.

## Quick start

Requires Docker Desktop and (optionally) Node.js 22+ for running outside containers.

```bash
# 1. Configure env
cp .env.example .env                       # repo-root vars (Postgres, pgAdmin, Vite)
cp server/.env.example server/.env         # server vars (DATABASE_URL, JWT, Resend)
$EDITOR .env server/.env                   # fill in real values

# 2. Bring up the stack
docker compose up -d                       # starts postgres + pgAdmin + server + frontend

# 3. Verify
#   - pgAdmin:   http://localhost:8080
#   - API:       http://localhost:8000
#   - Frontend:  http://localhost:5173
```

The database is initialised from `server/db_init/init.sql` on first boot (mounted into the Postgres container as a `docker-entrypoint-initdb.d` script).

### Running locally without Docker

```bash
# Backend
cd server
npm install
node server.js                             # uses DATABASE_URL from server/.env

# Frontend
cd frontend
npm install
npm run dev
```

## Data pipeline

The crawler uses the public [`erlichsefi/israeli-supermarket-scarpers`](https://hub.docker.com/r/erlichsefi/israeli-supermarket-scarpers) image, which polls each chain's portal continuously. SmartCart's wrapper turns that into a one-shot run by watching the download directory and stopping the container once new files stop appearing.

```bash
# Full pipeline: wipe my_prices/, crawl, then parse
bash server/crawler.sh

# Re-parse what's already on disk (no crawl)
bash server/crawler.sh --skip-crawl

# Add to existing dumps instead of wiping
bash server/crawler.sh --keep-files

# Tune the auto-stop
bash server/crawler.sh --idle-seconds 300 --max-minutes 60
```

PowerShell equivalent is `server/crawl.ps1` with `-SkipCrawl`, `-KeepFiles`, `-IdleSecondsToStop`, `-MaxCrawlMinutes`.

The parser tracks per-file ingestion stats so silent schema mismatches show up:

```text
Price update for branch 042 done: {"seen":6938,"inserted":6938,"skippedEmpty":0,"skippedStructured":0,"skippedBadPrice":0,"dbErrors":0}
LOW INSERT RATE for .../Bareket/PriceFull...xml: 0/6938
```

A non-zero `skippedStructured` or a `LOW INSERT RATE` warning usually means a chain changed its XML field names; add an alias to the `getField(...)` call in `parsePriceFile` and re-run.

## Project layout

```
SmartCart/
├── docker-compose.yml          # postgres, pgadmin, server, frontend
├── .env.example                # repo-root env (compose substitution)
├── server/
│   ├── server.js               # Express app entry
│   ├── crawler.sh              # Linux pipeline runner (auto-stop)
│   ├── crawl.ps1               # PowerShell equivalent (gitignored)
│   ├── Dockerfile
│   ├── db/
│   │   ├── parser.js           # streaming XML → SQL
│   │   ├── run-parser.js       # walks my_prices/ folders
│   │   ├── sortfolder.js       # dispatches Store vs Price files
│   │   └── organizefiles.js    # post-process file moves
│   ├── db_init/
│   │   └── init.sql            # full schema (app + app2)
│   ├── routes/                 # auth, family, lists, products, price_alerts, socket, token
│   ├── middleware/auth.js      # JWT verification
│   └── utils/
└── frontend/
    ├── Dockerfile + nginx.conf
    ├── vite.config.js
    └── src/
        ├── pages/              # Login, Register, ListDetail, ForgotPassword, ResetPassword
        ├── components/
        ├── context/AuthContext.jsx
        ├── api.js              # axios client
        └── socket.js           # socket.io-client
```

## Database schemas

- `app` — pricing data (`chains`, `sub_chains`, `branches`, `items`, `prices`, `price_history`) and shopping-list tables (`list`, `list_items`, `list_members`, `list_invites`, `list_templates`, `template_items`, `list_item_comments`, `list_chat`, `push_tokens`, `price_alerts`, `activity_log`).
- `app2` — authentication and family (`users`, `tokens`, `kid_requests`, plus the runtime-bootstrapped `login_attempts` and `refresh_rotations`).

The DDL also declares `app.list_users` and `app.template_schedules` and an `app2.chains/branches/items/prices` quartet — none of those are referenced by any code path and they're effectively dead. Cleaning them up is on the schema-migration list.

Full DDL lives in [`server/db_init/init.sql`](server/db_init/init.sql).

## Configuration

There are three env files in play (all gitignored). Each one is read by a different process, so the same value sometimes appears in more than one place — that's intentional.

| File             | Read by                                                              | What it's for                                                |
| ---------------- | -------------------------------------------------------------------- | ------------------------------------------------------------ |
| `./.env`         | `docker-compose` (variable substitution)                             | Postgres + pgAdmin creds, frontend build arg                 |
| `./server/.env`  | Node server (`node server.js`) and the crawler scripts               | DB URL, JWT secrets, Resend, public URLs, crawler paths      |
| `./frontend/.env`| Vite dev server (`npm run dev` outside Docker)                       | `VITE_API_URL` for local frontend dev                        |

Copy the `.example` files next to them and fill in real values:

```bash
cp .env.example .env
cp server/.env.example server/.env
# frontend/.env is only needed if you run `npm run dev` outside Docker
```

### `./.env` (repo root)

Consumed by `docker-compose.yml` via `${VAR}` substitution.

| Variable                  | Example                          | Notes                                                                                                  |
| ------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `POSTGRES_USER`           | `smartcart`                      | Bootstrapped into the `postgres` container on first boot.                                              |
| `POSTGRES_PASSWORD`       | `smartcart123`                   | Same — change before any non-local deploy.                                                             |
| `POSTGRES_DB`             | `smartcart`                      | DB name created on first boot.                                                                         |
| `PGADMIN_DEFAULT_EMAIL`   | `admin@smartcart.local`          | pgAdmin login at <http://localhost:8080>.                                                              |
| `PGADMIN_DEFAULT_PASSWORD`| `admin`                          | pgAdmin login.                                                                                         |
| `VITE_API_URL`            | *(empty)*                        | Baked into the frontend bundle. Leave empty for the Docker setup — nginx proxies `/api` and `/socket.io` to the server, so the browser uses root-relative URLs. Only set this to an absolute URL when the frontend and API live on different origins. |

Inside `docker-compose.yml`, the server's `DATABASE_URL` is built from the three `POSTGRES_*` values above and points at the `postgres` service hostname, so you do **not** need to keep `DATABASE_URL` in sync manually for the Docker workflow.

### `./server/.env`

Consumed directly by the Node process and by `crawler.sh` / `crawl.ps1`.

**Database**

| Variable        | Example                                                                          | Notes                                                                                            |
| --------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`  | `postgresql://smartcart:smartcart123@localhost:15432/smartcart?sslmode=disable`  | Used when running `node server.js` on the host. Docker overrides this via the compose `environment:` block. |

**HTTP + logging**

| Variable     | Example                                              | Notes                                                                                                  |
| ------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `PORT`       | `8000`                                               | Express listen port. Also used to build the default `BACKEND_URL` when that's blank.                   |
| `CORS`       | `http://localhost:5173,http://localhost:4173`        | Comma-separated allow-list for browser origins (CORS + Socket.io). Must include every frontend origin. |
| `NODE_ENV`   | `development`                                        | Controls cookie flags (`secure` + `sameSite=none` when `production`) and dev-only response fields.     |
| `LOG_LEVEL`  | `info`                                               | Winston log level (`error` / `warn` / `info` / `http` / `verbose` / `debug` / `silly`).                |

**Auth (JWT)**

All four are required. Server startup fails fast if any of them are missing.

| Variable              | Example                                | Notes                                                                                              |
| --------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`          | 64-byte hex string                     | Signs short-lived access tokens. Generate with `openssl rand -hex 64`.                             |
| `JWT_REFRESH_SECRET`  | 64-byte hex string                     | Signs the refresh-token cookie. Use a **different** value from `JWT_SECRET`.                       |
| `JWT_EMAIL_SECRET`    | 64-byte hex string                     | Signs the one-time email-verification link sent on `/api/register`. Different from the others.    |
| `JWT_RESET_SECRET`    | 64-byte hex string                     | Signs the password-reset link sent on `/api/forgot-password`. Different from the others.          |

**Email (Resend)**

| Variable          | Example                                  | Notes                                                                                                                                            |
| ----------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RESEND_API_KEY`  | `re_xxxxxxxxxxxxxxxxxxxxxx`              | Get one from <https://resend.com/api-keys>. If blank: `/api/register` will fail to send the verify link, and `/api/forgot-password` logs the reset URL to the console instead (dev only). |
| `FROM_EMAIL`      | `SmartCart <noreply@yourdomain.com>`     | Must be a verified Resend sender — usually a verified domain you own. If blank, falls back to `SmartCart <onboarding@resend.dev>`, which Resend only delivers to the account owner's email. |
| `BACKEND_URL`     | `https://api.smartcart.app`              | Public URL of this server. Used to build the link inside the email-verification email (which hits `/api/verify-email`). Defaults to `http://localhost:${PORT}`. |
| `FRONTEND_URL`    | `https://smartcart.app`                  | Public URL of the React app. Used to build reset-password links and the post-verification redirect. Defaults to `http://localhost:5173`.         |

**Crawler (only needed for `crawler.sh` / `crawl.ps1`)**

| Variable       | Example                                                  | Notes                                                                                          |
| -------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `PROJECT_DIR`  | `/home/me/SmartCart/server`                              | Absolute path to `server/` on the host. The crawler script `cd`s here.                         |
| `SERVER_DIR`   | `/home/me/SmartCart/server`                              | Same as above — kept separate so the PowerShell version can override one without the other.    |
| `TARGET_DIR`   | `/home/me/SmartCart/server/my_prices`                    | Where the Docker scraper writes XML dumps; `run-parser.js` walks this folder.                  |
| `DOCKER_PATH`  | `docker`                                                 | Executable used to launch the scraper container. Override if `docker` isn't on `PATH`.         |

### `./frontend/.env`

Only used by `npm run dev` outside Docker.

| Variable        | Example                  | Notes                                                                                              |
| --------------- | ------------------------ | -------------------------------------------------------------------------------------------------- |
| `VITE_API_URL`  | `http://localhost:8000`  | Origin of the API the dev server should hit. Inside Docker, this same variable lives in repo-root `.env` and is passed in as a build arg instead. |
