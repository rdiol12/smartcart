import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import validator from "validator";
import { Resend } from "resend";
import { renderEmail } from "../utils/emailTemplate.js";
import { authenticateToken } from "../middleware/auth.js";
import { authLimiter, passwordResetLimiter } from "../middleware/rateLimiter.js";
import {
  lockoutMsRemaining,
  recordFailedLogin,
  resetLoginAttempts,
} from "../utils/loginAttempts.js";
import {
  wasRecentlyRotated,
  recordRotation,
} from "../utils/refreshRotations.js";
import { registerValidator, loginValidator } from "../middleware/validators.js";
import { logger } from "../utils/logger.js";
import db from "../utils/db.js";


const router = Router();
const saltRounds = 10;

/**
 * Cookie attributes for the refresh-token cookie.
 * Prod: secure + sameSite=none so it works cross-origin over HTTPS.
 * Dev:  insecure + sameSite=lax so it survives plain-HTTP localhost.
 */
const refreshCookieOptions = () => {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
};

/**
 * Helper: sign a short-lived access JWT. No DB write.
 */
const generateAccessToken = (userId) =>
  jwt.sign({ sub: userId, type: "access" }, process.env.JWT_SECRET, {
    expiresIn: "15m",
  });

/**
 * Helper: mint a new refresh token row + signed JWT. The row id is the jti.
 */
const generateRefreshToken = async (userId, db) => {
  const { rows } = await db.query(
    `INSERT INTO app2.tokens (user_id, type, expires_at, used)
     VALUES ($1, 'refresh', NOW() + interval '7 days', false)
     RETURNING id`,
    [userId],
  );
  return jwt.sign(
    { sub: userId, jti: rows[0].id, type: "refresh" },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: "7d" },
  );
};

/**
 * Helper: Generate access + refresh tokens for a user.
 */
const generateTokens = async (userId, db) => {
  const refreshToken = await generateRefreshToken(userId, db);
  const accessToken = generateAccessToken(userId);
  return { accessToken, refreshToken };
};

/**
 * Helper: Send an email via Resend.
 * RESEND_API_KEY must be set; FROM_EMAIL must be a verified Resend sender.
 */
const resendClient = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const sendEmail = async ({ to, subject, html, text }) => {
  if (!resendClient) {
    throw new Error("RESEND_API_KEY is not set");
  }
  const from = process.env.FROM_EMAIL || "SmartCart <onboarding@resend.dev>";
  const { error } = await resendClient.emails.send({
    from,
    to,
    subject,
    html,
    text,
  });
  if (error) {
    throw new Error(error.message || JSON.stringify(error));
  }
};

// ─── Public routes (no auth required) ───────────────────────────────────────

/**
 * POST /api/register
 */
router.post("/register", authLimiter, registerValidator, async (req, res) => {
  const { first_name, last_name, email, password, confirmPassword } = req.body;

  try {
    if (!first_name || !last_name || !email || !password || !confirmPassword) {
      return res.status(400).json({ message: "All fields are required" });
    }
    if (!validator.isEmail(email)) {
      return res.status(400).json({ message: "Invalid email format" });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: "Password too short" });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match" });
    }

    const genericResponse = {
      message:
        "Registration received. If this email is not already registered, a verification link has been sent.",
    };

    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const inserted = await db.query(
      `INSERT INTO app2.users (first_name, last_name, email, password_hash, email_verified_at)
       VALUES ($1, $2, $3, $4, NULL)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [first_name, last_name, email, hashedPassword],
    );

    let userId;
    if (inserted.rowCount > 0) {
      userId = inserted.rows[0].id;
    } else {
      // Email exists. Only resend verification if the account is still
      // unverified; never overwrite the original credentials.
      const existing = await db.query(
        "SELECT id FROM app2.users WHERE email = $1 AND email_verified_at IS NULL",
        [email],
      );
      if (existing.rowCount === 0) {
        return res.status(201).json(genericResponse);
      }
      userId = existing.rows[0].id;
      await db.query(
        "DELETE FROM app2.tokens WHERE user_id = $1 AND type = 'email_verify' AND used = false",
        [userId],
      );
    }

    const { rows } = await db.query(
      `INSERT INTO app2.tokens (user_id, type, expires_at, used)
       VALUES ($1, 'email_verify', NOW() + interval '15 minutes', false)
       RETURNING id`,
      [userId],
    );
    const tokenId = rows[0].id;

    const token = jwt.sign(
      { sub: userId, type: "email_verify", jti: tokenId },
      process.env.JWT_EMAIL_SECRET,
      { expiresIn: "15m" },
    );

    const backendUrl =
      process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 8000}`;
    const verifyLink = `${backendUrl}/api/verify-email?token=${encodeURIComponent(token)}`;

    try {
      const { html, text } = renderEmail({
        title: "אימות כתובת המייל",
        intro:
          "ברוך הבא ל-SmartCart! לחץ על הכפתור כדי לאמת את כתובת המייל ולסיים את ההרשמה. הקישור תקף ל-15 דקות.",
        ctaText: "אימות מייל",
        ctaUrl: verifyLink,
      });
      await sendEmail({
        to: email,
        subject: "אימות כתובת המייל · SmartCart",
        html,
        text,
      });
    } catch (emailErr) {
      logger.error("Email sending error", { error: emailErr.message, stack: emailErr.stack });
      await db.query("DELETE FROM app2.tokens WHERE id = $1", [tokenId]);
      return res.status(201).json(genericResponse);
    }

    return res.status(201).json(genericResponse);
  } catch (err) {
    logger.error("Registration error", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Error registering user" });
  }
});

/**
 * GET /api/verify-email
 */
router.get("/verify-email", async (req, res) => {
  const token = req.query.token;

  try {
    const payload = jwt.verify(token, process.env.JWT_EMAIL_SECRET);

    if (payload.type !== "email_verify") {
      return res.status(400).json({ message: "Invalid token type" });
    }

    const tokenResult = await db.query(
      "SELECT used FROM app2.tokens WHERE id = $1 AND user_id = $2 AND type = 'email_verify' AND expires_at > NOW()",
      [payload.jti, payload.sub],
    );

    if (tokenResult.rowCount === 0) {
      return res.status(400).json({ message: "Token not found or expired" });
    }
    if (tokenResult.rows[0].used) {
      return res.status(400).json({ message: "Token already used" });
    }

    const userResult = await db.query(
      `UPDATE app2.users
         SET email_verified_at = NOW()
       WHERE id = $1 AND email_verified_at IS NULL
       RETURNING id, first_name, last_name, email`,
      [payload.sub],
    );

    if (userResult.rowCount === 0) {
      return res.status(400).json({ message: "Already verified or invalid" });
    }

    const user = userResult.rows[0];
    await db.query("UPDATE app2.tokens SET used = true WHERE id = $1", [
      payload.jti,
    ]);

    // Only mint the refresh cookie — the access token would be discarded by
    // res.redirect anyway. AuthContext on the frontend bootstraps by calling
    // /api/refresh, which trades the cookie for a fresh access token.
    const refreshToken = await generateRefreshToken(user.id, db);
    res.cookie("refreshToken", refreshToken, refreshCookieOptions());

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    return res.redirect(`${frontendUrl}/verification-confirmed`);
  } catch (err) {
    logger.error("JWT Verification Detail", { error: err.message });
    if (err.name === "JsonWebTokenError")
      return res.status(400).json({ message: "Invalid token signature" });
    if (err.name === "TokenExpiredError")
      return res
        .status(400)
        .json({ message: "Token expired - please register again" });
    return res.status(400).json({ message: "Invalid or expired token" });
  }
});

/**
 * POST /api/login
 */
router.post("/login", authLimiter, loginValidator, async (req, res) => {
  const { email, username, password } = req.body;
  const identifier = email || username;

  // Per-account lockout on top of per-IP authLimiter. authLimiter caps a single
  // IP; this layer caps repeated failures against one account across IPs.
  const lockedMs = await lockoutMsRemaining(identifier);
  if (lockedMs) {
    return res.status(429).json({
      message: `Account temporarily locked due to failed login attempts. Try again in ${Math.ceil(lockedMs / 60000)} minute(s).`,
    });
  }

  try {
    const userColumns =
      "id, first_name, email, username, parent_id, password_hash, email_verified_at";
    let results;
    if (email) {
      results = await db.query(
        `SELECT ${userColumns} FROM app2.users WHERE email = $1`,
        [email],
      );
    } else {
      results = await db.query(
        `SELECT ${userColumns} FROM app2.users WHERE username = $1`,
        [username],
      );
    }

    if (results.rows.length === 0) {
      await recordFailedLogin(identifier);
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const user = results.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      await recordFailedLogin(identifier);
      return res.status(400).json({ message: "Invalid credentials" });
    }

    if (!user.email_verified_at) {
      return res
        .status(403)
        .json({ message: "Please verify your email before logging in" });
    }

    await resetLoginAttempts(identifier);

    const { accessToken, refreshToken } = await generateTokens(user.id, db);

    res.cookie("refreshToken", refreshToken, refreshCookieOptions());

    return res.status(200).json({
      user: {
        id: user.id,
        first_name: user.first_name,
        email: user.email,
        username: user.username,
        parent_id: user.parent_id || null,
      },
    });
  } catch (err) {
    logger.error("Login error", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Error logging in" });
  }
});

/**
 * POST /api/refresh
 *
 * Concurrent /api/refresh from the same cookie (SPA mount fires multiple
 * parallel requests) is handled via DB-backed rotation grace in
 * utils/refreshRotations.js. The winning pod records the old jti as
 * rotated; losing pods see the record and return a fresh access token
 * without re-rotating. Survives restarts and works across instances.
 */
router.post("/refresh", async (req, res) => {
  const incomingToken = req.cookies.refreshToken || req.body.refreshToken;

  if (!incomingToken) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const payload = jwt.verify(incomingToken, process.env.JWT_REFRESH_SECRET);

    if (payload.type !== "refresh") {
      return res.status(403).json({ message: "Invalid token type" });
    }

    const consumed = await db.query(
      `DELETE FROM app2.tokens
        WHERE id = $1 AND user_id = $2 AND type = 'refresh'
        RETURNING id`,
      [payload.jti, payload.sub],
    );

    if (consumed.rowCount === 0) {
      // Lost the race against a concurrent rotation? Check the grace table.
      if (await wasRecentlyRotated(payload.jti)) {
        // Benign — the winning pod already minted a new refresh cookie and
        // sent it on its response. Just hand back a fresh access token; the
        // browser will use the cookie this pod isn't touching.
        return res.json({ accessToken: generateAccessToken(payload.sub) });
      }
      // Genuine reuse — nuke every refresh token for this user.
      await db.query(
        "DELETE FROM app2.tokens WHERE user_id = $1 AND type = 'refresh'",
        [payload.sub],
      );
      return res.status(403).json({ message: "Token reuse detected" });
    }

    // We won the rotation. Record so losing siblings get the grace path.
    await recordRotation(payload.jti);

    const { accessToken, refreshToken } = await generateTokens(payload.sub, db);
    res.cookie("refreshToken", refreshToken, refreshCookieOptions());

    return res.json({ accessToken });
  } catch (err) {
    logger.error("Refresh error", { error: err.message, stack: err.stack });
    return res.status(403).json({ message: "Invalid refresh token" });
  }
});

/**
 * POST /api/logout
 */
router.post("/logout", async (req, res) => {
  const refreshToken = req.cookies.refreshToken;

  if (refreshToken) {
    try {
      const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
      if (payload?.jti && payload?.sub) {
        await db.query(
          "DELETE FROM app2.tokens WHERE id = $1 AND user_id = $2 AND type = 'refresh'",
          [payload.jti, payload.sub],
        );
      }
    } catch (e) {
      logger.info("Logout token verification failed", { error: e.message });
    }
  }

  const { maxAge: _ignored, ...clearOpts } = refreshCookieOptions();
  res.clearCookie("refreshToken", clearOpts);
  return res.status(200).json({ message: "Logged out" });
});

/**
 * POST /api/forgot-password
 */
router.post("/forgot-password", passwordResetLimiter, async (req, res) => {
  const { email } = req.body;

  if (!email) return res.status(400).json({ message: "Email is required" });
  if (!validator.isEmail(email))
    return res.status(400).json({ message: "Invalid email format" });

  try {
    const results = await db.query(
      "SELECT id FROM app2.users WHERE email = $1",
      [email],
    );

    const genericResponse = {
      message:
        "If an account exists for that email, a reset link has been sent",
    };

    if (results.rows.length === 0) {
      return res.status(200).json(genericResponse);
    }

    const userId = results.rows[0].id;
    const { rows } = await db.query(
      `INSERT INTO app2.tokens (user_id, type, expires_at, used, data)
       VALUES ($1, 'reset_password', NOW() + interval '15 minutes', false, NULL)
       RETURNING id`,
      [userId],
    );

    const tokenId = rows[0].id;
    const token = jwt.sign(
      { sub: userId, jti: tokenId, type: "reset_password" },
      process.env.JWT_RESET_SECRET,
      { expiresIn: "15m" },
    );

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

    if (process.env.RESEND_API_KEY) {
      try {
        const { html, text } = renderEmail({
          title: "איפוס סיסמה",
          intro:
            "קיבלנו בקשה לאיפוס הסיסמה שלך. לחץ על הכפתור כדי לבחור סיסמה חדשה. הקישור תקף ל-15 דקות.",
          ctaText: "איפוס סיסמה",
          ctaUrl: resetUrl,
          footerNote:
            "אם לא ביקשת לאפס את הסיסמה, אפשר להתעלם מהמייל הזה — הסיסמה לא תשתנה.",
        });
        await sendEmail({
          to: email,
          subject: "איפוס סיסמה · SmartCart",
          html,
          text,
        });
      } catch (emailErr) {
        logger.error("Email sending error", { error: emailErr.message, stack: emailErr.stack });
        return res.status(200).json(genericResponse);
      }
    } else {
      logger.warn("SMTP not configured. Reset link", { error: resetUrl.message, stack: resetUrl.stack });
      if (process.env.NODE_ENV !== "production") {
        return res.status(200).json({ ...genericResponse, resetUrl });
      }
    }

    return res.status(200).json(genericResponse);
  } catch (err) {
    logger.error("Forgot password error", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Error sending reset email" });
  }
});

/**
 * POST /api/reset-password
 */
router.post("/reset-password", passwordResetLimiter, async (req, res) => {
  const { token, newPassword, confirmNewPassword } = req.body;

  if (!token || !newPassword || !confirmNewPassword) {
    return res.status(400).json({ message: "Missing fields" });
  }
  if (newPassword !== confirmNewPassword) {
    return res.status(400).json({ message: "Passwords do not match" });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ message: "Password too weak" });
  }

  try {
    const decodedToken = jwt.verify(token, process.env.JWT_RESET_SECRET);
    const userId = decodedToken.sub;

    const { rows } = await db.query(
      `SELECT expires_at, used FROM app2.tokens
       WHERE user_id = $1 AND type = 'reset_password' AND id = $2 AND expires_at > NOW()`,
      [userId, decodedToken.jti],
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Token not found or expired" });
    }
    if (rows[0].used) {
      return res.status(400).json({ message: "Token already used" });
    }

    const results = await db.query(
      "SELECT password_hash FROM app2.users WHERE id = $1",
      [userId],
    );

    if (results.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const isSame = await bcrypt.compare(
      newPassword,
      results.rows[0].password_hash,
    );
    if (isSame) {
      return res
        .status(400)
        .json({ message: "New password must differ from current" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    await db.query("UPDATE app2.users SET password_hash = $1 WHERE id = $2", [
      hashedPassword,
      userId,
    ]);
    await db.query("UPDATE app2.tokens SET used = true WHERE id = $1", [
      decodedToken.jti,
    ]);

    return res.status(200).json({ message: "Password reset successfully" });
  } catch (err) {
    logger.error("Reset password error", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Error resetting password" });
  }
});

// ─── Protected routes (auth required) ───────────────────────────────────────
router.use(authenticateToken);
/**
 * GET /api/me
 */
router.get("/me", async (req, res) => {

  try {
    const results = await db.query(
      "SELECT id, first_name, last_name, email, username, parent_id FROM app2.users WHERE id = $1",
      [req.userId],
    );

    if (results.rows.length === 0) {
      return res.status(404).json({ user: null });
    }

    return res.status(200).json({ user: results.rows[0] });
  } catch (err) {
    logger.error("Get user error", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * POST /api/logout-all
 */
router.post("/logout-all", async (req, res) => {

  try {
    await db.query(
      "DELETE FROM app2.tokens WHERE user_id = $1 AND type = 'refresh'",
      [req.userId],
    );

    const { maxAge: _ignored, ...clearOpts } = refreshCookieOptions();
    res.clearCookie("refreshToken", clearOpts);

    return res.status(200).json({ message: "Logged out from all devices" });
  } catch (err) {
    logger.error("Logout all error", { error: err.message, stack: err.stack });
    return res
      .status(500)
      .json({ message: "Error logging out from all devices" });
  }
});

/**
 * PUT /api/user/password
 */
router.put("/user/password", async (req, res) => {
  const { currentPassword, newPassword, confirmNewPassword } = req.body;

  if (!currentPassword || !newPassword || !confirmNewPassword) {
    return res.status(400).json({ message: "Missing fields" });
  }
  if (newPassword !== confirmNewPassword) {
    return res.status(400).json({ message: "Passwords do not match" });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ message: "Password too weak" });
  }
  if (currentPassword === newPassword) {
    return res
      .status(400)
      .json({ message: "New password must differ from current" });
  }

  try {
    const { rows } = await db.query(
      "SELECT password_hash FROM app2.users WHERE id = $1",
      [req.userId],
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    const isMatch = await bcrypt.compare(
      currentPassword,
      rows[0].password_hash,
    );
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid current password" });
    }
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    await db.query("UPDATE app2.users SET password_hash = $1 WHERE id = $2", [
      hashedPassword,
      req.userId,
    ]);
    return res.status(200).json({ message: "Password updated successfully" });
  } catch (err) {
    logger.error("Password change error", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Error updating password" });
  }
});

/**
 * DELETE /api/user
 * Permanently delete the caller's account. Requires current password for
 * confirmation. Cascade: app2.tokens, child users (parent_id), and
 * app2.kid_requests are removed automatically via FK ON DELETE CASCADE.
 */
router.delete("/user", async (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ message: "Password required" });
  }

  try {
    const { rows } = await db.query(
      "SELECT password_hash FROM app2.users WHERE id = $1",
      [req.userId],
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    const isMatch = await bcrypt.compare(password, rows[0].password_hash);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid password" });
    }

    await db.query("DELETE FROM app2.users WHERE id = $1", [req.userId]);

    const { maxAge: _ignored, ...clearOpts } = refreshCookieOptions();
    res.clearCookie("refreshToken", clearOpts);

    return res.status(200).json({ message: "Account deleted" });
  } catch (err) {
    logger.error("Account deletion error", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Error deleting account" });
  }
});

export default router;
