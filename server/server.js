import express from "express";
import "./utils/env.js";
import { validateEnv } from "./utils/env.js";
import cors from "cors";
import cookieParser from "cookie-parser";
import http from "http";
import { Server } from "socket.io";
import cron from "node-cron";
import registerSocketHandlers from "./routes/socket.js";
import db from "./utils/db.js";
import snapshotPrices from "./utils/snapshot_prices.js";
import { ensureSchema } from "./utils/bootstrap.js";

// Import middleware
import { apiLimiter } from "./middleware/rateLimiter.js";
import { correlationId } from "./middleware/correlationId.js";
import { logger, requestLogger, errorLogger } from "./utils/logger.js";

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

const port = process.env.PORT || 8000;
const app = express();

function parseTrustProxy(v) {
  if (v === undefined || v === "") return 1;
  if (v === "true") return true;
  if (v === "false") return false;
  const n = Number(v);
  return Number.isFinite(n) ? n : v;
}
app.set("trust proxy", parseTrustProxy(process.env.TRUST_PROXY));
const server = http.createServer(app);

const corsOptions = {
  origin: (process.env.CORS || "http://localhost:3000").split(","),
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  credentials: true,
};

const io = new Server(server, { cors: corsOptions });

registerSocketHandlers(io);

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

app.locals.io = io;

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
if (process.env.NODE_ENV !== "test") {
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
}

app.get("/health", apiLimiter, (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

app.use(errorLogger);
app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    message: err.message || "Internal server error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

const shutdown = async () => {
  logger.info("Shutting down gracefully...");

  const forceExit = setTimeout(() => {
    logger.error("Could not close connections in time, forcing exit");
    process.exit(1);
  }, 10000);
  forceExit.unref();

  try {
    await new Promise((resolve) => io.close(resolve));
    logger.info("Socket.io closed.");

    await new Promise((resolve) => server.close(resolve));
    logger.info("HTTP server closed.");

    await db.end();
    logger.info("Database pool closed.");

    clearTimeout(forceExit);
    process.exit(0);
  } catch (err) {
    logger.error("Error during graceful shutdown", { error: err.message });
    process.exit(1);
  }
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

if (process.env.NODE_ENV !== "test") {
  server.listen(port, () => {
    logger.info(`SmartCart server running on port ${port}`);
  });
}

export default app;
