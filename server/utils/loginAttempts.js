import db from "./db.js";

/**
 * Per-account login attempt tracker, DB-backed. After MAX_ATTEMPTS failed
 * logins within ATTEMPT_WINDOW_MIN on the same identifier (email or
 * username), lock that account for LOCKOUT_MIN regardless of source IP.
 * Reset on success.
 *
 * Lives in app2.login_attempts so state survives process restarts and is
 * shared across horizontally-scaled instances. The previous in-memory map
 * evaporated on cold starts (every ~15 min of idle on Render free tier),
 * making lockout an empty threat to anything more determined than a
 * dumb script.
 *
 * Trade-off (unchanged from the in-memory version): any identifier-based
 * lockout is also a small DoS vector — an attacker can lock a victim out
 * by failing 5 times on their email. The 15-min window is short enough
 * to recover from automatically.
 */
const ATTEMPT_WINDOW_MIN = 15;
const LOCKOUT_MIN = 15;
const MAX_ATTEMPTS = 5;

/**
 * Returns 0 if the identifier is not locked, otherwise the number of ms
 * until the lock expires.
 */
export async function lockoutMsRemaining(identifier) {
  if (!identifier) return 0;
  const { rows } = await db.query(
    `SELECT EXTRACT(EPOCH FROM (locked_until - NOW())) * 1000 AS ms
     FROM app2.login_attempts
     WHERE identifier = $1 AND locked_until > NOW()`,
    [identifier],
  );
  if (rows.length === 0) return 0;
  // Defensive: if the math returns NaN/Infinity for any reason (clock weirdness,
  // unexpected NULL), don't propagate that into "Try again in NaN minute(s)".
  const ms = Number(rows[0].ms);
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms)) : 0;
}

export async function recordFailedLogin(identifier) {
  if (!identifier) return;
  // The CASE expressions reset the counter and clear lockout once the
  // attempt window has elapsed, otherwise increment and lock at threshold.
  // ATTEMPT_WINDOW_MIN / LOCKOUT_MIN / MAX_ATTEMPTS are constants we own,
  // not user input, so interpolating them is fine.
  await db.query(
    `INSERT INTO app2.login_attempts AS la (identifier, count, first_failed_at, locked_until)
     VALUES ($1, 1, NOW(), NULL)
     ON CONFLICT (identifier) DO UPDATE SET
       count = CASE
         WHEN la.first_failed_at < NOW() - INTERVAL '${ATTEMPT_WINDOW_MIN} minutes' THEN 1
         ELSE la.count + 1
       END,
       first_failed_at = CASE
         WHEN la.first_failed_at < NOW() - INTERVAL '${ATTEMPT_WINDOW_MIN} minutes' THEN NOW()
         ELSE la.first_failed_at
       END,
       locked_until = CASE
         WHEN la.first_failed_at < NOW() - INTERVAL '${ATTEMPT_WINDOW_MIN} minutes' THEN NULL
         WHEN la.count + 1 >= ${MAX_ATTEMPTS} THEN NOW() + INTERVAL '${LOCKOUT_MIN} minutes'
         ELSE NULL
       END`,
    [identifier],
  );
}

export async function resetLoginAttempts(identifier) {
  if (!identifier) return;
  await db.query("DELETE FROM app2.login_attempts WHERE identifier = $1", [
    identifier,
  ]);
}
