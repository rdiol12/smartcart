import jwt from "jsonwebtoken";

// Reason codes attached to 401 responses so the SPA can branch:
//   TOKEN_EXPIRED  → access token's exp has passed; safe to /api/refresh and retry.
//   TOKEN_INVALID  → signature mismatch, malformed, or wrong type; log out, don't retry.
//   TOKEN_MISSING  → no Authorization header; user isn't authenticated.
// The plain `message` stays human-readable; the `code` is the machine signal.
export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res
      .status(401)
      .json({ code: "TOKEN_MISSING", message: "Access token required" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    if (payload.type !== "access") {
      return res
        .status(401)
        .json({ code: "TOKEN_INVALID", message: "Invalid token type" });
    }

    req.userId = payload.sub;
    req.user = { id: payload.sub };
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res
        .status(401)
        .json({ code: "TOKEN_EXPIRED", message: "Access token expired" });
    }
    return res
      .status(401)
      .json({ code: "TOKEN_INVALID", message: "Invalid token" });
  }
};
