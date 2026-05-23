import express from "express";
import "./utils/env.js";
import { validateEnv } from "./utils/env.js";
import cors from "cors";
import cookieParser from "cookie-parser";
import http from "http";
import { Server } from "socket.io";
import cron from "node-cron";
import registerSocketHandlers from "./routes/socket.js";
import { authenticateToken } from "./middleware/auth.js";
import db from "./utils/db.js";
import snapshotPrices from "./utils/snapshot_prices.js";
import { ensureSchema } from "./utils/bootstrap.js";

// Import middleware
import { apiLimiter } from "./middleware/rateLimiter.js";
import { correlationId } from "./middleware/correlationId.js";
import { logger, requestLogger, errorLogger } from "./utils/logger.js";

// Fail fast at boot if any required env var is missing.
validateEnv();

// Import routes
import authRoutes from "./routes/auth.js";
import listsRoutes from "./routes/lists.js";
import familyRoutes from "./routes/family.js";
import productsRoutes from "./routes/simplified_products.js";
import token from "./routes/token.js";
import price_alerts from "./routes/price_alerts.js";
import activity_feed from "./routes/activity_feed.js";
import templatesRoutes from "./routes/templates.js";

// 8000 matches auth.js's BACKEND_URL fallback. Defaulting to two different
// ports in two files meant /api/verify-email links could land on a port the
// server wasn't actually listening on.
const port = process.env.PORT || 8000;
const app = express();

// `trust proxy` controls which X-Forwarded-For hop req.ip resolves to. The
// previous hardcoded `1` was right for Render/Railway (one proxy in front)
// but wrong the moment something sits behind Cloudflare → nginx → app, at
// which point IP-based rate limiting would key on the wrong hop. Drive
// from env. Accepts numbers ("2"), booleans ("true"/"false"), or an
// Express trust-proxy expression string ("loopback,linklocal,uniquelocal").
function parseTrustProxy(v) {
  if (v === undefined || v === "") return 1;
  if (v === "true") return true;
  if (v === "false") return false;
  const n = Number(v);
  return Number.isFinite(n) ? n : v;
}
app.set("trust proxy", parseTrustProxy(process.env.TRUST_PROXY));
const server = http.createServer(app);

// One CORS config shared by Express and Socket.IO. Defining it twice in two
// places that read the same env var is exactly how the two end up drifting
// when someone updates one and forgets the other.
const corsOptions = {
  origin: (process.env.CORS || "http://localhost:5173").split(","),
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  credentials: true,
};

// Socket.io setup
const io = new Server(server, { cors: corsOptions });

// Register all socket events
registerSocketHandlers(io);

// Test database connection + ensure runtime schema (lockout / rotation tables /
// search index). async/await to match the rest of the codebase — callback-style
// here was the last holdout.
try {
  await db.query("SELECT NOW()");
  logger.info("PostgreSQL connected (israel_shopping_db)");
  await ensureSchema();
} catch (err) {
  logger.error("Database connection or schema bootstrap failed", {
    error: err.message,
    stack: err.stack,
  });
  process.exit(1);
}

// Middleware
app.use(correlationId); // Tag every request with X-Correlation-ID for log tracing
app.use(requestLogger); // Structured logging
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(cors(corsOptions));

// Make io available to REST routes that need to emit socket events. db is no
// longer set here — every route file imports it directly from utils/db.js.
app.locals.io = io;

// Apply general rate limiting to all API routes
app.use("/api", apiLimiter);

// Routes
app.use("/api", authRoutes);
app.use("/api/lists", listsRoutes);
app.use("/api/family", familyRoutes);
app.use("/api", productsRoutes);
app.use("/api/push-token", token);
app.use("/api/price-alerts", price_alerts);
app.use("/api/activity/feed", activity_feed);
app.use("/api/templates", templatesRoutes);


const LOCK_PRICE_SNAPSHOT = 4242424242;
cron.schedule("0 2 * * *", async () => {
  const client = await db.connect();
  try {
    const { rows } = await client.query(
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [LOCK_PRICE_SNAPSHOT],
    );
    if (!rows[0].acquired) {
      logger.info("[Price Snapshot] Lock held by another instance, skipping");
      return;
    }
    try {
      await snapshotPrices(client);
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [
        LOCK_PRICE_SNAPSHOT,
      ]);
    }
  } catch (err) {
    logger.error("[Price Snapshot] Error", { error: err.message });
  } finally {
    client.release();
  }
});

// Health check endpoint
app.get("/health", apiLimiter, (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// Error logging and handling
app.use(errorLogger);
app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    message: err.message || "Internal server error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

server.listen(port, () => {
  logger.info(`SmartCart server running on port ${port}`);
});
