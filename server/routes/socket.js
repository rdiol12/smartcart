import jwt from "jsonwebtoken";
import { logger } from "../utils/logger.js";
import db from "../utils/db.js";
import assertMember from "../utils/assertmember.js";
import logActivity from "../utils/logActivity.js";
import { addItem } from "../services/listItems.js";
import { parseSocketPayload } from "../utils/socketValidate.js";
import { rateLimitOk } from "../utils/tokenBucket.js";
import {
  joinListSchema,
  sendItemSchema,
  toggleItemSchema,
  deleteItemSchema,
  updateQuantitySchema,
} from "../utils/socketSchemas.js";

const EVENTS = {
  MEMBER: new Set([
    "join_list",
    "send_item",
    "toggle_item",
    "delete_item",
    "update_quantity",
    "mark_paid",
    "unmark_paid",
    "add_comment",
  ]),

  MUTATION: new Set([
    "send_item",
    "toggle_item",
    "delete_item",
    "update_quantity",
    "mark_paid",
    "unmark_paid",
    "create_list",
    "add_comment",
  ]),
};

// Track user's active socket connections for cleanup
const userSockets = new Map();

// Helper function to emit to all user's connected sockets
export function emitToUser(io, userId, event, data) {
  io.to(`user_${userId}`).emit(event, data);
}

// Helper to get user's active socket count
export function getUserSocketCount(userId) {
  return userSockets.get(userId)?.size || 0;
}

// Helper to kick user from all rooms
export function kickUserFromAllRooms(io, userId, reason = "kicked") {
  const sockets = userSockets.get(userId);
  if (sockets) {
    sockets.forEach((socketId) => {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit("kicked", { reason });
        socket.disconnect(true);
      }
    });
  }
}

export default function registerSocketHandlers(io) {
  // JWT Authentication middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Unauthorized"));

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (payload.type !== "access") return next(new Error("Unauthorized"));

      socket.user = { id: payload.sub };
      return next();
    } catch (err) {
      logger.error("Socket auth error", { error: err.message });
      return next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    logger.info("Socket connected", {
      socketId: socket.id,
      userId: socket.user.id,
    });

    // Track user's sockets
    if (!userSockets.has(socket.user.id)) {
      userSockets.set(socket.user.id, new Set());
    }
    userSockets.get(socket.user.id).add(socket.id);

    // Rate limiting middleware for mutations
    socket.use(async ([event], next) => {
      try {
        if (!EVENTS.MUTATION.has(event)) return next();

        const ok = await rateLimitOk(socket.user.id);
        if (!ok) {
          logger.warn("Rate limit exceeded", {
            userId: socket.user.id,
            event,
          });
          socket.emit("error", {
            message: "Too many requests, please slow down",
            code: "RATE_LIMITED",
          });
          return next(new Error("rate_limited"));
        }

        return next();
      } catch (err) {
        logger.error("Rate limiter error", { error: err.message });
        return next();
      }
    });

    // Membership validation middleware
    socket.use(async ([event, data], next) => {
      try {
        if (!EVENTS.MEMBER.has(event)) return next();

        const listId =
          typeof data === "object" && data !== null ? data.listId : data;

        if (!listId) {
          socket.emit("error", {
            message: "Missing listId",
            code: "MISSING_LIST_ID",
          });
          return next(new Error("Missing listId"));
        }

        await assertMember(listId, socket.user.id);
        return next();
      } catch (err) {
        logger.warn("Membership failed", {
          event,
          userId: socket.user.id,
          error: err.message,
        });
        socket.emit("error", {
          message: "Not authorized for this list",
          code: "UNAUTHORIZED",
        });
        return next(new Error("Forbidden"));
      }
    });

    // ---------------- EVENT HANDLERS ----------------

    // Register user for private notifications
    socket.on("register_user", () => {
      const userRoom = `user_${socket.user.id}`;
      socket.join(userRoom);
      logger.debug("User registered", {
        userId: socket.user.id,
        room: userRoom,
      });

      // Acknowledge registration
      socket.emit("user_registered", { userId: socket.user.id });
    });

    // Join list room
    socket.on("join_list", (raw) => {
      const listId = parseSocketPayload(socket, joinListSchema, raw);
      if (!listId) return;

      const room = String(listId);
      socket.join(room);
      logger.debug("User joined list room", {
        userId: socket.user.id,
        listId: room,
      });

      // Acknowledge join
      socket.emit("list_joined", { listId });
    });

    // Leave list room (optional - for cleanup)
    socket.on("leave_list", (raw) => {
      const listId = parseSocketPayload(socket, joinListSchema, raw);
      if (!listId) return;

      const room = String(listId);
      socket.leave(room);
      logger.debug("User left list room", {
        userId: socket.user.id,
        listId: room,
      });

      socket.emit("list_left", { listId });
    });

    // Add item to list
    socket.on("send_item", async (data) => {
      try {
        const v = parseSocketPayload(socket, sendItemSchema, data);
        if (!v) return;

        const { listId, itemName, price, storeName, quantity, productId } = v;

        const { newItem } = await addItem({
          listId,
          userId: socket.user.id,
          itemName,
          price,
          storeName,
          quantity,
          productId: productId || null,
        });

        // Broadcast to all members in the list
        io.to(String(listId)).emit("receive_item", newItem);

        // Acknowledge to sender
        socket.emit("item_sent", { item: newItem });

        // Log activity asynchronously (don't await)
        logActivity(listId, socket.user.id, "item_added", itemName).catch(
          (err) => {
            logger.error("Failed to log activity", { error: err.message });
          },
        );

        logger.info("Item added", {
          listId,
          userId: socket.user.id,
          itemName,
        });
      } catch (err) {
        logger.error("send_item error", {
          error: err.message,
          userId: socket.user.id,
        });
        socket.emit("error", {
          message: "Failed to add item",
          code: "ADD_ITEM_FAILED",
        });
      }
    });

    // Toggle item checked status
    socket.on("toggle_item", async (data) => {
      try {
        const v = parseSocketPayload(socket, toggleItemSchema, data);
        if (!v) return;

        const { itemId, listId, isChecked } = v;

        const result = await db.query(
          `UPDATE app.list_items
           SET is_checked = $1, 
               checked_by = $2,
               updatedat = NOW()
           WHERE id = $3 AND listid = $4
           RETURNING id`,
          [isChecked, socket.user.id, itemId, listId],
        );

        if (result.rowCount === 0) {
          socket.emit("error", {
            message: "Item not found",
            code: "ITEM_NOT_FOUND",
          });
          return;
        }

        io.to(String(listId)).emit("item_status_changed", {
          itemId,
          isChecked,
          checkedBy: isChecked ? socket.user.id : null,
          checkedAt: new Date().toISOString(),
        });

        logger.debug("Item toggled", { itemId, listId, isChecked });
      } catch (err) {
        logger.error("toggle_item error", { error: err.message });
        socket.emit("error", {
          message: "Failed to toggle item",
          code: "TOGGLE_FAILED",
        });
      }
    });

    // Delete item
    socket.on("delete_item", async (data) => {
      try {
        const v = parseSocketPayload(socket, deleteItemSchema, data);
        if (!v) return;

        const { itemId, listId } = v;

        const result = await db.query(
          "DELETE FROM app.list_items WHERE id = $1 AND listid = $2 RETURNING id",
          [itemId, listId],
        );

        if (result.rowCount === 0) {
          socket.emit("error", {
            message: "Item not found",
            code: "ITEM_NOT_FOUND",
          });
          return;
        }

        io.to(String(listId)).emit("item_deleted", { itemId });

        logger.info("Item deleted", { itemId, listId, userId: socket.user.id });
      } catch (err) {
        logger.error("delete_item error", { error: err.message });
        socket.emit("error", {
          message: "Failed to delete item",
          code: "DELETE_FAILED",
        });
      }
    });

    // Update item quantity
    socket.on("update_quantity", async (data) => {
      try {
        const v = parseSocketPayload(socket, updateQuantitySchema, data);
        if (!v) return;

        const { itemId, listId, quantity } = v;

        if (quantity < 1) {
          socket.emit("error", {
            message: "Quantity must be at least 1",
            code: "INVALID_QUANTITY",
          });
          return;
        }

        const result = await db.query(
          "UPDATE app.list_items SET quantity = $1, updatedat = NOW() WHERE id = $2 AND listid = $3 RETURNING id",
          [quantity, itemId, listId],
        );

        if (result.rowCount === 0) {
          socket.emit("error", {
            message: "Item not found",
            code: "ITEM_NOT_FOUND",
          });
          return;
        }

        io.to(String(listId)).emit("quantity_updated", {
          itemId,
          quantity,
          updatedBy: socket.user.id,
          updatedAt: new Date().toISOString(),
        });

        logger.debug("Quantity updated", { itemId, quantity, listId });
      } catch (err) {
        logger.error("update_quantity error", { error: err.message });
        socket.emit("error", {
          message: "Failed to update quantity",
          code: "UPDATE_FAILED",
        });
      }
    });

    // ============================================
    // MARK AS PAID & UNMARK AS PAID HANDLERS
    // ============================================

    // Mark item as paid
    socket.on("mark_paid", async (data) => {
      try {
        const { itemId, listId } = data;

        if (!itemId || !listId) {
          socket.emit("error", {
            message: "Missing itemId or listId",
            code: "MISSING_PARAMS",
          });
          return;
        }

        const result = await db.query(
          `UPDATE app.list_items 
           SET paid_by = $1, paid_at = NOW() 
           WHERE id = $2 AND listid = $3 
           RETURNING id`,
          [socket.user.id, itemId, listId],
        );

        if (result.rowCount === 0) {
          socket.emit("error", {
            message: "Item not found",
            code: "ITEM_NOT_FOUND",
          });
          return;
        }

        // Get user info for the response
        const userResult = await db.query(
          "SELECT first_name FROM app2.users WHERE id = $1",
          [socket.user.id],
        );

        io.to(String(listId)).emit("item_paid", {
          itemId,
          paid_by: socket.user.id,
          paid_by_name: userResult.rows[0]?.first_name || "User",
          paid_at: new Date().toISOString(),
        });

        // Log activity
        await logActivity(
          listId,
          socket.user.id,
          "item_paid",
          `Item ${itemId} marked as paid`,
        );

        logger.info("Item marked as paid", {
          itemId,
          listId,
          userId: socket.user.id,
        });
      } catch (err) {
        logger.error("mark_paid error", {
          error: err.message,
          userId: socket.user.id,
        });
        socket.emit("error", {
          message: "Failed to mark as paid",
          code: "MARK_PAID_FAILED",
        });
      }
    });

    // Unmark item as paid
    socket.on("unmark_paid", async (data) => {
      try {
        const { itemId, listId } = data;

        if (!itemId || !listId) {
          socket.emit("error", {
            message: "Missing itemId or listId",
            code: "MISSING_PARAMS",
          });
          return;
        }

        const result = await db.query(
          `UPDATE app.list_items 
           SET paid_by = NULL, paid_at = NULL 
           WHERE id = $1 AND listid = $2 
           RETURNING id`,
          [itemId, listId],
        );

        if (result.rowCount === 0) {
          socket.emit("error", {
            message: "Item not found",
            code: "ITEM_NOT_FOUND",
          });
          return;
        }

        io.to(String(listId)).emit("item_unpaid", {
          itemId,
        });

        // Log activity
        await logActivity(
          listId,
          socket.user.id,
          "item_unpaid",
          `Item ${itemId} unmarked as paid`,
        );

        logger.info("Item unmarked as paid", {
          itemId,
          listId,
          userId: socket.user.id,
        });
      } catch (err) {
        logger.error("unmark_paid error", {
          error: err.message,
          userId: socket.user.id,
        });
        socket.emit("error", {
          message: "Failed to unmark as paid",
          code: "UNMARK_PAID_FAILED",
        });
      }
    });

    // ============================================
    // ADD COMMENT HANDLER
    // ============================================

    socket.on("add_comment", async (data) => {
      try {
        const { itemId, listId, comment } = data;

        if (!itemId || !listId || !comment || !comment.trim()) {
          socket.emit("error", {
            message: "Missing required fields",
            code: "MISSING_PARAMS",
          });
          return;
        }

        // Verify user is a member of the list
        await assertMember(listId, socket.user.id);

        // Insert the comment
        const result = await db.query(
          `INSERT INTO app.list_item_comments (item_id, user_id, comment, created_at)
           VALUES ($1, $2, $3, NOW())
           RETURNING id, created_at`,
          [itemId, socket.user.id, comment.trim()]
        );

        // Get user info for the response
        const userResult = await db.query(
          "SELECT first_name FROM app2.users WHERE id = $1",
          [socket.user.id],
        );

        const newComment = {
          id: result.rows[0].id,
          item_id: itemId,
          user_id: socket.user.id,
          user_name: userResult.rows[0]?.first_name || "User",
          comment: comment.trim(),
          created_at: result.rows[0].created_at,
        };

        // Broadcast to all members in the list
        io.to(String(listId)).emit("comment_added", newComment);

        // Log activity
        await logActivity(
          listId,
          socket.user.id,
          "comment_added",
          `Added comment to item ${itemId}`,
        );

        logger.info("Comment added", {
          itemId,
          listId,
          userId: socket.user.id,
          commentId: newComment.id,
        });
      } catch (err) {
        logger.error("add_comment error", {
          error: err.message,
          userId: socket.user.id,
        });
        socket.emit("error", {
          message: "Failed to add comment",
          code: "ADD_COMMENT_FAILED",
        });
      }
    });

    // ============================================
    // CREATE LIST HANDLER
    // ============================================

    socket.on("create_list", async (data, callback) => {
      try {
        const { list_name } = data;

        if (!list_name || !list_name.trim()) {
          return callback({ success: false, error: "List name is required" });
        }

        if (list_name.length > 200) {
          return callback({
            success: false,
            error: "List name too long (max 200 characters)",
          });
        }

        // Create the list
        const listResult = await db.query(
          "INSERT INTO app.list (list_name) VALUES ($1) RETURNING id",
          [list_name.trim()],
        );

        const listId = listResult.rows[0].id;

        // Add the user as admin
        await db.query(
          "INSERT INTO app.list_members (list_id, user_id, status) VALUES ($1, $2, 'admin')",
          [listId, socket.user.id],
        );

        // Join the socket room
        socket.join(String(listId));

        // Log activity
        await logActivity(
          listId,
          socket.user.id,
          "list_created",
          `Created list: ${list_name}`,
        );

        logger.info("List created via socket", {
          listId,
          list_name,
          userId: socket.user.id,
        });

        callback({ success: true, listId });
      } catch (err) {
        logger.error("Error creating list via socket", {
          error: err.message,
          userId: socket.user.id,
        });
        callback({ success: false, error: "Failed to create list" });
      }
    });

    // Handle disconnection
    socket.on("disconnect", () => {
      // Remove socket from tracking
      if (userSockets.has(socket.user.id)) {
        userSockets.get(socket.user.id).delete(socket.id);
        if (userSockets.get(socket.user.id).size === 0) {
          userSockets.delete(socket.user.id);
          logger.debug("User has no more active connections", {
            userId: socket.user.id,
          });
        }
      }

      logger.info("Socket disconnected", {
        socketId: socket.id,
        userId: socket.user.id,
      });
    });
  });

  // Clean up stale connections periodically (every hour)
  const cleanupInterval = setInterval(
    () => {
      const activeUsers = userSockets.size;
      const totalSockets = Array.from(userSockets.values()).reduce(
        (sum, set) => sum + set.size,
        0,
      );

      logger.debug("Active user sockets stats", {
        activeUsers,
        totalSockets,
        avgSocketsPerUser: activeUsers
          ? (totalSockets / activeUsers).toFixed(2)
          : 0,
      });
    },
    60 * 60 * 1000,
  );

  // Cleanup interval on server close
  io.on("close", () => {
    clearInterval(cleanupInterval);
  });
}

// Export for use in other modules
export { userSockets };
