import { config } from "dotenv";

config();

const REQUIRED = [
  "DATABASE_URL",
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
  "JWT_EMAIL_SECRET",
  "JWT_RESET_SECRET",
];

/**
 * Validate that every required env var is set, otherwise exit. Previously a
 * missing JWT_EMAIL_SECRET or JWT_RESET_SECRET silently broke registration and
 * password reset — jwt.sign would throw "secretOrPrivateKey must have a value"
 * from inside the route handler, the catch would swallow it, and users got the
 * generic "we sent you a link" with nothing actually sent.
 *
 * Exposed as a function (not a top-level side effect) so importing this module
 * from a test harness with partial env doesn't nuke the test runner.
 * server.js calls validateEnv() at boot.
 */
export function validateEnv() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length === 0) return;
  // eslint-disable-next-line no-console
  console.error(
    `Missing required env vars: ${missing.join(", ")}. ` +
      `See README for the full list.`,
  );
  process.exit(1);
}
