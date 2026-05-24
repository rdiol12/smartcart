import jwt from "jsonwebtoken";
import { logger } from "../utils/logger.js";
import db from "../utils/db.js";
import assertMember from "../utils/assertmember.js";
import logActivity from "../utils/logActivity.js";
import { assertNotChild } from "../utils/userPolicy.js";
import { addItem, reorderItems } from "../services/listItems.js";
import { messages } from "../utils/messages.js";
import { parseSocketPayload } from "../utils/socketValidate.js";
import {
  joinListSchema,
  sendItemSchema,
  toggleItemSchema,
  deleteItemSchema,
  markPaidSchema,
  updateQuantitySchema,
  updateNoteSchema,
  createListSchema,
  addCommentSchema,
  sendChatMessageSchema,
  assignItemSchema,
  reorderItemsSchema,
} from "../utils/socketSchemas.js";

// Expo error codes that mean "this device token is gone for good".
// Per https://docs.expo.dev/push-notifications/sending-notifications/#individual-errors
const EXPO_DEAD_TOKEN_ERRORS = new Set([
  "DeviceNotRegistered",
  "InvalidCredentials",
]);

async function sendPushNotifications(userIds, title, body, data = {}) {
  try {
    if (!userIds || userIds.length === 0) return;
    const placeholders = userIds.map((_, i) => `$${i + 1}`).join(",");
    const result = await db.query(
      `SELECT token FROM app.push_tokens WHERE user_id IN (${placeholders})`,
      userIds,
    );
    const tokens = result.rows
      .map((r) => r.token)
      .filter(
        (t) => typeof t === "string" && t.startsWith("ExponentPushToken"),
      );

    if (tokens.length === 0) return;

    const messages = tokens.map((token) => ({
      to: token,
      sound: "default",
      title,
      body,
      data,
    }));

    const deadTokens = [];
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      const resp = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(chunk),
      });
      // Expo returns per-ticket results in the same order as the request.
      // Inspect them so we can prune tokens Expo has told us are dead instead
      // of resending to them forever.
      let payload;
      try {
        payload = await resp.json();
      } catch (_jsonErr) {
        continue;
      }
      const tickets = Array.isArray(payload?.data) ? payload.data : [];
      tickets.forEach((ticket, idx) => {
        if (
          ticket?.status === "error" &&
          EXPO_DEAD_TOKEN_ERRORS.has(ticket?.details?.error)
        ) {
          deadTokens.push(chunk[idx].to);
        }
      });
    }

    if (deadTokens.length > 0) {
      await db.query(
        "DELETE FROM app.push_tokens WHERE token = ANY($1::text[])",
        [deadTokens],
      );
      logger.info("Pruned dead push tokens", { count: deadTokens.length });
    }
  } catch (err) {
    logger.error("Error sending push notifications", {
      error: err.message,
      stack: err.stack,
    });
  }
}

// Socket rate limiting is implemented via a Postgres-backed token bucket
// in `server/utils/tokenBucket.js` so limits are shared across pods.
import { rateLimitOk } from "../utils/tokenBucket.js";

const MUTATION_EVENTS = new Set([
  "send_item",
  "toggle_item",
  "delete_item",
  "mark_paid",
  "unmark_paid",
  "update_quantity",
  "update_note",
  "create_list",
  "add_comment",
  "send_chat_message",
  "assign_item",
  "reorder_items",
]);

// The previous in-memory Map was removed in favor of Postgres-backed buckets.

export default function registerSocketHandlers(io) {
  // Inline JWT verify. The previous fake req/res adapter that shoehorned the
  // Express authenticateToken middleware in here was clever but brittle —
  // any change to that middleware's response shape would have silently
  // broken socket auth.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Unauthorized"));
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (payload.type !== "access") return next(new Error("Unauthorized"));
      socket.user = { id: payload.sub };
      next();
    } catch (_err) {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    logger.info("Socket connected", { socketId: socket.id });

    // Post-join handlers verify membership via socket.rooms.has(listId)
    // instead of a per-event DB SELECT. join_list (below) is the one place
    // that still does the DB check — that's where membership is actually
    // established and the room is joined. Trade-off: a user who's been
    // kicked from a list but still has an open socket can keep mutating
    // until they disconnect. If that gap matters more than the per-event
    // DB latency, force-leave them from the room on the kick path
    // (currently family.js DELETE /lists/:id/children/:childId,
    // lists.js POST /:id/leave, and lists.js DELETE /:id).

    // Drop mutation events that exceed the per-user rate. Read-only and
    // bookkeeping events (join_list, register_user) pass through untouched.
    socket.use(async ([event], next) => {
      try {
        if (MUTATION_EVENTS.has(event)) {
          const ok = await rateLimitOk(socket.user.id);
          if (!ok) return next(new Error("rate_limited"));
        }
        next();
      } catch (err) {
        // On DB/store errors, allow the request (fail-open) but log.
        logger.error("Rate limiter error", { error: err.message });
        next();
      }
    });

    socket.on("disconnect", () => {
      logger.info("Socket disconnected", { socketId: socket.id });
      // Don't delete rate state here — the bucket is keyed by user id and
      // we want it to survive reconnects so a hostile client can't refresh
      // their burst by cycling the connection. The periodic sweep handles
      // cleanup for genuinely abandoned users.
    });

    socket.on("register_user", () => {
      socket.join(`user_${socket.user.id}`);
      logger.info(`User ${socket.user.id} registered for notifications`);
    });

    socket.on("join_list", async (rawListId) => {
      const listId = parseSocketPayload(socket, joinListSchema, rawListId);
      if (listId === null) return;
      try {
        await assertMember(listId, socket.user.id);
        socket.join(String(listId));
        logger.info(`User ${socket.user.id} joined list: ${listId}`);
      } catch (err) {
        if (err.message === "Not a member") {
          logger.warn(
            `User ${socket.user.id} tried to join list ${listId} without membership`,
          );
          return;
        }
        logger.error("join_list error", {
          error: err.message,
          stack: err.stack,
        });
      }
    });

    socket.on("send_item", async (data) => {
      const validated = parseSocketPayload(socket, sendItemSchema, data);
      if (!validated) return;
      const { listId, itemName, price, storeName, quantity, productId } =
        validated;
      const addby = socket.user.id;

      try {
        // Ensure the socket's user is still a member of the list before
        // allowing mutations. This prevents a revoked-but-still-connected
        // user from continuing to mutate until disconnect.
        await assertMember(listId, addby);

        const { newItem, adderName } = await addItem({
          listId,
          userId: addby,
          itemName,
          price,
          storeName,
          quantity,
          productId: productId || null,
        });

        io.to(String(listId)).emit("receive_item", newItem);
        logActivity(listId, addby, "item_added", `Added item: ${itemName}`);

        try {
          const members = await db.query(
            "SELECT user_id FROM app.list_members WHERE list_id = $1 AND user_id != $2",
            [listId, addby],
          );
          const memberIds = members.rows.map((m) => m.user_id);
          if (memberIds.length > 0) {
            sendPushNotifications(
              memberIds,
              messages.push_new_item_title,
              messages.push_new_item_body(adderName, itemName),
              {
                type: "item_added",
                listId,
              },
            );
          }
        } catch (pushErr) {
          logger.error("Push notification error", {
            error: pushErr.message,
            stack: pushErr.stack,
          });
        }
      } catch (e) {
        if (e.message === "Not a member") {
          socket.emit("item_error", { message: "Not a member of this list" });
        } else if (e.code === "IS_CHILD") {
          socket.emit("item_error", {
            message: "Child accounts cannot add items directly",
          });
        } else if (e.code === "USER_NOT_FOUND") {
          socket.emit("item_error", { message: "User not found" });
        } else {
          logger.error("Error saving item", {
            error: e.message,
            stack: e.stack,
          });
          socket.emit("item_error", { message: "Error adding item" });
        }
      }
    });

    socket.on("toggle_item", async (data) => {
      const validated = parseSocketPayload(socket, toggleItemSchema, data);
      if (!validated) return;
      const { itemId, listId, isChecked } = validated;
      const userId = socket.user.id;
      try {
        await assertMember(listId, userId);
        const res = await db.query(
          `WITH updated AS (
             UPDATE app.list_items
                SET is_checked = $1, checked_by = $2
              WHERE id = $3 AND listid = $4
              RETURNING 1
           )
           SELECT CASE WHEN $1 THEN (SELECT first_name FROM app2.users WHERE id = $5) END AS checked_by_name
             FROM updated`,
          [isChecked, isChecked ? userId : null, itemId, listId, userId],
        );
        const checkedByName = res.rows[0]?.checked_by_name ?? null;

        io.to(String(listId)).emit("item_status_changed", {
          itemId,
          isChecked,
          checkedBy: isChecked ? userId : null,
          checkedByName,
        });

        logActivity(
          listId,
          userId,
          "item_toggled",
          `Item ${itemId} toggled to ${isChecked}`,
        );
      } catch (err) {
        logger.error("Toggle error", { error: err.message, stack: err.stack });
      }
    });

    socket.on("delete_item", async (data) => {
      const validated = parseSocketPayload(socket, deleteItemSchema, data);
      if (!validated) return;
      const { itemId, listId } = validated;
      const userId = socket.user.id;
      try {
        await assertMember(listId, userId);
        await db.query(
          "DELETE FROM app.list_items WHERE id = $1 AND listId = $2",
          [itemId, listId],
        );
        io.to(String(listId)).emit("item_deleted", { itemId });
        logActivity(listId, userId, "item_deleted", `Deleted item ${itemId}`);
      } catch (err) {
        logger.error("Delete error", { error: err.message, stack: err.stack });
      }
    });

    socket.on("mark_paid", async (data) => {
      const validated = parseSocketPayload(socket, markPaidSchema, data);
      if (!validated) return;
      const { itemId, listId } = validated;
      const userId = socket.user.id;
      try {
        await assertMember(listId, userId);
        const result = await db.query(
          `WITH updated AS (
             UPDATE app.list_items
                SET paid_by = $1, paid_at = NOW()
              WHERE id = $2 AND listid = $3
              RETURNING paid_at
           )
           SELECT updated.paid_at, u.first_name AS paid_by_name
             FROM updated
             LEFT JOIN app2.users u ON u.id = $1`,
          [userId, itemId, listId],
        );
        const paid_at = result.rows[0]?.paid_at;
        const paid_by_name = result.rows[0]?.paid_by_name;

        io.to(String(listId)).emit("item_paid", {
          itemId,
          paid_by: userId,
          paid_by_name,
          paid_at,
        });
        logActivity(listId, userId, "item_paid", `Paid for item ${itemId}`);
      } catch (err) {
        logger.error("Mark paid error", {
          error: err.message,
          stack: err.stack,
        });
      }
    });

    socket.on("unmark_paid", async (data) => {
      const validated = parseSocketPayload(socket, markPaidSchema, data);
      if (!validated) return;
      const { itemId, listId } = validated;
      const userId = socket.user.id;
      try {
        await assertMember(listId, userId);
        await db.query(
          "UPDATE app.list_items SET paid_by = NULL, paid_at = NULL WHERE id = $1 AND listId = $2",
          [itemId, listId],
        );
        io.to(String(listId)).emit("item_unpaid", { itemId });
      } catch (err) {
        logger.error("Unmark paid error", {
          error: err.message,
          stack: err.stack,
        });
      }
    });

    socket.on("update_quantity", async (data) => {
      const validated = parseSocketPayload(socket, updateQuantitySchema, data);
      if (!validated) return;
      const { itemId, listId, quantity } = validated;
      const userId = socket.user.id;
      try {
        await assertMember(listId, userId);
        await db.query(
          "UPDATE app.list_items SET quantity = $1 WHERE id = $2 AND listId = $3",
          [quantity, itemId, listId],
        );
        io.to(String(listId)).emit("quantity_updated", { itemId, quantity });
      } catch (err) {
        logger.error("Update quantity error", {
          error: err.message,
          stack: err.stack,
        });
      }
    });

    socket.on("update_note", async (data) => {
      const validated = parseSocketPayload(socket, updateNoteSchema, data);
      if (!validated) return;
      const { itemId, listId, note } = validated;
      const userId = socket.user.id;
      try {
        await assertMember(listId, userId);
        const result = await db.query(
          `WITH updated AS (
             UPDATE app.list_items
                SET note = $1, note_by = $2
              WHERE id = $3 AND listid = $4
              RETURNING 1
           )
           SELECT u.first_name AS note_by_name
             FROM updated
             LEFT JOIN app2.users u ON u.id = $2`,
          [note || null, userId, itemId, listId],
        );
        const note_by_name = result.rows[0]?.note_by_name;

        io.to(String(listId)).emit("note_updated", {
          itemId,
          note,
          note_by: userId,
          note_by_name,
        });
      } catch (err) {
        logger.error("Update note error", {
          error: err.message,
          stack: err.stack,
        });
      }
    });

    socket.on("create_list", async (list, callback) => {
      const validated = parseSocketPayload(
        socket,
        createListSchema,
        list,
        callback,
        "create_list",
      );
      if (!validated) return;
      const { list_name } = validated;
      // Always use the authenticated user — never trust client-supplied userId
      const userId = socket.user.id;

      const client = await db.getClient();
      try {
        await client.query("BEGIN");
        await assertNotChild(userId);

        const listRes = await client.query(
          "INSERT INTO app.list (list_name) VALUES ($1) RETURNING id",
          [list_name],
        );
        const newListId = listRes.rows[0].id;

        await client.query(
          "INSERT INTO app.list_members (list_id, user_id, status) VALUES ($1, $2, $3)",
          [newListId, userId, "admin"],
        );
        await client.query("COMMIT");
        callback({ success: true, listId: newListId });
      } catch (e) {
        await client.query("ROLLBACK");
        if (e.code === "IS_CHILD") {
          return callback({
            success: false,
            error: "Child accounts cannot create lists",
          });
        }
      } finally {
        client.release();
      }
    });

    socket.on("add_comment", async (data) => {
      const validated = parseSocketPayload(socket, addCommentSchema, data);
      if (!validated) return;
      const { itemId, listId, comment } = validated;
      const userId = socket.user.id;
      try {
        await assertMember(listId, userId);
        const result = await db.query(
          `WITH existing AS (
             SELECT id FROM app.list_item_comments
              WHERE item_id = $1 AND user_id = $2
           ),
           inserted AS (
             INSERT INTO app.list_item_comments (item_id, user_id, comment, created_at)
             SELECT $1, $2, $3, NOW()
              WHERE NOT EXISTS (SELECT 1 FROM existing)
             RETURNING id, created_at
           )
           SELECT inserted.id, inserted.created_at, u.first_name
             FROM inserted
             LEFT JOIN app2.users u ON u.id = $2`,
          [itemId, userId, comment],
        );

        if (result.rows.length === 0) {
          logger.info(`User ${userId} already has a comment on item ${itemId}`);
          return;
        }

        const newComment = {
          id: result.rows[0].id,
          item_id: itemId,
          user_id: userId,
          first_name: result.rows[0].first_name || "User",
          comment,
          created_at: result.rows[0].created_at,
        };

        io.to(String(listId)).emit("receive_comment", {
          itemId,
          comment: newComment,
        });
      } catch (err) {
        logger.error("Add comment error", {
          error: err.message,
          stack: err.stack,
        });
      }
    });

    socket.on("send_chat_message", async (data) => {
      const validated = parseSocketPayload(socket, sendChatMessageSchema, data);
      if (!validated) return;
      const userId = socket.user.id;
      const { listId, message } = validated;
      try {
        await assertMember(listId, userId);
        const result = await db.query(
          `WITH inserted AS (
             INSERT INTO app.list_chat (list_id, user_id, message)
             VALUES ($1, $2, $3)
             RETURNING id, created_at
           )
           SELECT inserted.id, inserted.created_at, u.first_name
             FROM inserted
             LEFT JOIN app2.users u ON u.id = $2`,
          [listId, userId, message],
        );
        const row = result.rows[0];

        io.to(String(listId)).emit("receive_chat_message", {
          id: row.id,
          listId,
          userId,
          firstName: row.first_name || "User",
          message,
          createdAt: row.created_at,
        });
      } catch (err) {
        logger.error("Chat message error", {
          error: err.message,
          stack: err.stack,
        });
      }
    });

    socket.on("assign_item", async (data) => {
      const validated = parseSocketPayload(socket, assignItemSchema, data);
      if (!validated) return;
      const { itemId, listId, assignedTo } = validated;
      try {
        await assertMember(listId, socket.user.id);
        // The WHERE also enforces "assignee must be a member of this list"
        // (null = unassign, which is allowed). Without it, the schema check
        // confirms `assignedTo` is a positive int — but doesn't enforce DB
        // state — and any random user id would have been accepted.
        const res = await db.query(
          `WITH updated AS (
             UPDATE app.list_items
                SET assigned_to = $1
              WHERE id = $2 AND listid = $3
                AND (
                  $1::int IS NULL OR EXISTS (
                    SELECT 1 FROM app.list_members
                    WHERE list_id = $3 AND user_id = $1
                  )
                )
              RETURNING 1
           )
           SELECT CASE WHEN $1::int IS NOT NULL
                    THEN (SELECT first_name FROM app2.users WHERE id = $1)
                  END AS assigned_to_name
             FROM updated`,
          [assignedTo, itemId, listId],
        );
        if (res.rows.length === 0) {
          // Either the item/list doesn't match, or assignedTo isn't a member.
          socket.emit("item_error", {
            message: "Cannot assign — invalid item or assignee not in list",
          });
          return;
        }
        const assignedToName = res.rows[0]?.assigned_to_name ?? null;

        io.to(String(listId)).emit("item_assigned", {
          itemId,
          assignedTo,
          assignedToName,
        });
      } catch (err) {
        logger.error("Assign item error", {
          error: err.message,
          stack: err.stack,
        });
      }
    });

    socket.on("reorder_items", async (data, callback) => {
      const validated = parseSocketPayload(
        socket,
        reorderItemsSchema,
        data,
        callback,
      );
      if (!validated) return;
      const { listId, items } = validated;

      try {
        await reorderItems({ listId, userId: socket.user.id, items });
        socket.to(String(listId)).emit("items_reordered", { items });
        callback?.({ success: true });
      } catch (err) {
        if (err.message === "Not a member") {
          return callback?.({ success: false, error: "Not a member" });
        }
        logger.error("Reorder error", { error: err.message, stack: err.stack });
        return callback?.({ success: false, error: "Server error" });
      }
    });
  });
}
