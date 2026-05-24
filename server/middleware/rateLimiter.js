import rateLimit from "express-rate-limit";
import { PostgresStore } from "@acpr/rate-limit-postgresql";

const dbConfig = {
  connectionString: process.env.DATABASE_URL,
};

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  store: new PostgresStore(dbConfig, "rate_limit_api"),
});

export const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  message: "Too many login attempts, please try again later.",
  skipSuccessfulRequests: true,
  store: new PostgresStore(dbConfig, "rate_limit_auth"),
});

export const searchLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: "Too many search requests, please slow down.",
  store: new PostgresStore(dbConfig, "rate_limit_search"),
});

export const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Too many password reset attempts, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  store: new PostgresStore(dbConfig, "rate_limit_reset"),
});
