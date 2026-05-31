import { logger } from "./logger.js";

/**
 * Force all open sockets for a user to leave a list room and notify
 * their client. Safe to call from any REST route via req.app.locals.io.
 */
export function kickUserFromList(io, userId, listId) {
  const room = String(listId);
  io.in(`user_${userId}`).socketsLeave(room);
  io.to(`user_${userId}`).emit("removed_from_list", { listId });
  logger.info("Kicked user sockets from list", { userId, listId });
}

/**
 * Force all open sockets for a user to leave every list room at once.
 * Used when an account is deleted.
 */
export function kickUserEntirely(io, userId) {
  io.in(`user_${userId}`).emit("account_deleted");
  io.in(`user_${userId}`).disconnectSockets(true);
  logger.info("Disconnected all sockets for deleted user", { userId });
}
