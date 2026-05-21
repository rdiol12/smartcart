import express from "express";
import morgan from "morgan";
import "./utils/env.js";
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
import { logger, requestLogger, errorLogger } from "./utils/logger.js";

// Import routes
import authRoutes from "./routes/auth.js";
import listsRoutes from "./routes/lists.js";
import familyRoutes from "./routes/family.js";
import productsRoutes from "./routes/simplified_products.js";
import token from "./routes/token.js";
import price_alerts from "./routes/price_alerts.js";
import activity_feed from "./routes/activity_feed.js";
import templatesRoutes from "./routes/templates.js";

const port = process.env.PORT || 3000;
const app = express();
app.set("trust proxy", 1);
const server = http.createServer(app);

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: (process.env.CORS || "http://localhost:5173").split(","),
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true,
  },
});

// Register all socket events
registerSocketHandlers(io);

// Test database connection + ensure runtime schema (lockout / rotation tables)
db.query("SELECT NOW()", (err) => {
  if (err) {
    logger.error("Database connection error", { error: err.message });
    return;
  }
  logger.info("PostgreSQL connected (israel_shopping_db)");
  ensureSchema().catch((schemaErr) => {
    logger.error("Schema bootstrap failed", {
      error: schemaErr.message,
      stack: schemaErr.stack,
    });
  });
});

// Middleware
app.use(requestLogger); // Structured logging
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(
  cors({
    origin: (process.env.CORS || "http://localhost:5173").split(","),
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true,
  }),
);

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

// Cron job: Daily price snapshot (runs at 2 AM every day)
cron.schedule("0 2 * * *", async () => {
  try {
    await snapshotPrices(db);
  } catch (err) {
    logger.error("[Price Snapshot] Error", { error: err.message });
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
