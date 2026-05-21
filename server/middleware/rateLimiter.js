import rateLimit from 'express-rate-limit';

// Note: every limiter here uses express-rate-limit's default MemoryStore.
// State is per-process, so the same client landing on two pods under
// horizontal scaling effectively doubles the ceiling on every limit
// (and the per-account lockout in utils/loginAttempts.js is the only
// thing in this codebase that actually crosses pods, because it lives
// in Postgres). If/when this deploys to >1 instance, swap the store
// for the official rate-limit-redis or rate-limit-postgres adapter.

// General API limiter
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict limiter for authentication endpoints. Account-level lockout
// (utils/loginAttempts.js) handles targeted brute force; this just caps
// raw request volume from a single IP.
export const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5,
  message: 'Too many login attempts, please try again later.',
  skipSuccessfulRequests: true,
});

// Search limiter (more generous)
export const searchLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 searches per minute
  message: 'Too many search requests, please slow down.',
});

// Password reset limiter. Cannot reuse authLimiter here: authLimiter sets
// skipSuccessfulRequests, and /forgot-password returns 200 to every caller
// (success-shape response even when the email is unregistered), so under
// authLimiter literally nothing counts. We need every request to count.
export const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: 'Too many password reset attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
