import rateLimit from "express-rate-limit";
import { PostgresStore } from "@acpr/rate-limit-postgresql";

const dbConfig = {
  connectionString: process.env.DATABASE_URL,
};

// Check if we're in development mode
const isDevelopment = process.env.NODE_ENV === "development";

// Development bypass middleware
const noopLimiter = (req, res, next) => next();

// Define limiters (will be reassigned based on environment)
let apiLimiter;
let authLimiter;
let searchLimiter;
let passwordResetLimiter;
let imageLimiter;
let staticDataLimiter;

if (isDevelopment) {
  // Development: use noop limiters
  apiLimiter = noopLimiter;
  authLimiter = noopLimiter;
  searchLimiter = noopLimiter;
  passwordResetLimiter = noopLimiter;
  imageLimiter = noopLimiter;
  staticDataLimiter = noopLimiter;
} else {
  // Production: use actual rate limiting
  // General API limiter - for non-critical endpoints
  apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500, // 500 requests per 15 minutes
    message: "Too many requests from this IP, please try again later.",
    standardHeaders: true,
    legacyHeaders: false,
    store: new PostgresStore(dbConfig, "rate_limit_api"),
    skipSuccessfulRequests: false,
  });

  // Auth limiter - for login/refresh/register
  authLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 20, // 20 requests per 5 minutes
    message: "Too many authentication attempts, please try again later.",
    skipSuccessfulRequests: true,
    store: new PostgresStore(dbConfig, "rate_limit_auth"),
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Search limiter - for product searches
  searchLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 120, // 120 searches per minute
    message: "Too many search requests, please slow down.",
    store: new PostgresStore(dbConfig, "rate_limit_search"),
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Password reset limiter (keep stricter for security)
  passwordResetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    message: "Too many password reset attempts, please try again later.",
    standardHeaders: true,
    legacyHeaders: false,
    store: new PostgresStore(dbConfig, "rate_limit_reset"),
  });

  // Image limiter - for product images
  imageLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 200, // 200 images per minute
    message: "Too many image requests, please slow down.",
    store: new PostgresStore(dbConfig, "rate_limit_image"),
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Categories/chains limiter (static data)
  staticDataLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 60, // 60 requests per 5 minutes
    message: "Too many requests for static data.",
    store: new PostgresStore(dbConfig, "rate_limit_static"),
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
  });
}

// Export all limiters
export {
  apiLimiter,
  authLimiter,
  searchLimiter,
  passwordResetLimiter,
  imageLimiter,
  staticDataLimiter,
};
