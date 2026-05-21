import { randomUUID } from "crypto";

/**
 * Tag every incoming request with a correlation ID so a user's failure can be
 * traced through the chain of operations it produced. Accepts an inbound
 * `X-Correlation-ID` header (e.g. from a frontend retry that wants to keep
 * the same id) or generates one. Echoes the id back on the response so
 * client-side error reports include it.
 *
 * Route handlers can read `req.correlationId` and include it in their
 * logger.* calls' metadata. The requestLogger in utils/logger.js already
 * picks it up automatically.
 */
export function correlationId(req, res, next) {
  const inbound = req.header("x-correlation-id");
  req.correlationId =
    inbound && /^[A-Za-z0-9-]{1,128}$/.test(inbound) ? inbound : randomUUID();
  res.setHeader("X-Correlation-ID", req.correlationId);
  next();
}
