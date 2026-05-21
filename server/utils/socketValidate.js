import { logger } from "./logger.js";

/**
 * Validate a socket event payload against a Zod schema.
 *
 * On success: returns the parsed (cleaned) data.
 * On failure: logs at warn level, then either calls `callback` with
 * { success:false, error } if one was provided, or emits "item_error"
 * on the socket. Returns null in both failure paths so the caller can
 * `if (!validated) return;`.
 */
export function parseSocketPayload(socket, schema, data, callback) {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const issue = result.error.issues[0];
  const path = issue?.path?.length ? issue.path.join(".") : "payload";
  const error = `${path}: ${issue?.message || "Invalid"}`;

  logger.warn(
    `Socket validation failed (user=${socket.user?.id}, event=${schema._eventName || "?"}): ${error}`,
  );

  if (typeof callback === "function") {
    callback({ success: false, error });
  } else {
    socket.emit("item_error", { message: error });
  }
  return null;
}
