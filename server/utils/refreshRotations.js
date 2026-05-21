import db from "./db.js";
import { logger } from "./logger.js";

/**
 * Refresh-token rotation grace, DB-backed. When concurrent /api/refresh
 * requests arrive with the same cookie, exactly one wins the atomic
 * DELETE-rotate and the rest see rowCount=0. Without grace, those losers
 * are treated as token theft and every refresh token for the user gets
 * nuked — so a single page load with multiple parallel API calls becomes
 * a logout weapon.
 *
 * Previously this was an in-process Map keyed by old jti. That worked for
 * a single instance but went out the window on a second pod: Pod A rotated,
 * Pod B knew nothing, Pod B nuked.
 *
 * Now: when a rotation succeeds, record the old jti in app2.refresh_rotations.
 * When reuse is detected, check that table — if the old jti was rotated in
 * the last GRACE_SECONDS, treat as benign concurrent refresh (mint a fresh
 * access token; the new refresh cookie is whatever the winning pod set).
 * If not, it's genuine reuse and the nuke fires.
 *
 * Trade-off: an attacker replaying a stolen refresh token within
 * GRACE_SECONDS of the legitimate use gets a fresh access token. Outside
 * the window, theft detection still fires.
 */
const GRACE_SECONDS = 10;

export async function wasRecentlyRotated(oldTokenId) {
  const { rows } = await db.query(
    `SELECT 1 FROM app2.refresh_rotations
     WHERE old_token_id = $1
       AND rotated_at > NOW() - INTERVAL '${GRACE_SECONDS} seconds'`,
    [oldTokenId],
  );
  return rows.length > 0;
}

export async function recordRotation(oldTokenId) {
  await db.query(
    `INSERT INTO app2.refresh_rotations (old_token_id, rotated_at)
     VALUES ($1, NOW())
     ON CONFLICT (old_token_id) DO UPDATE SET rotated_at = NOW()`,
    [oldTokenId],
  );
}

// Periodic prune. Sweep window is generous vs the grace check (10s) so we
// never delete a row that the grace path would still need.
const sweep = setInterval(() => {
  db.query(
    "DELETE FROM app2.refresh_rotations WHERE rotated_at < NOW() - INTERVAL '1 minute'",
  ).catch((err) =>
    logger.error("Refresh rotation sweep error", { error: err.message }),
  );
}, 60_000);
sweep.unref?.();
