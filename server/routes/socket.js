import { authenticateToken } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";
import db from "../utils/db.js";
import assertMember from "../utils/assertmember.js";
import logActivity from "../utils/logActivity.js";
import { assertNotChild } from "../utils/userPolicy.js";
import { addItem } from "../services/listItems.js";
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
      .filter((t) => t.startsWith("ExponentPushToken"));

    if (tokens.length === 0) return;

    const messages = tokens.map((token) => ({
      to: token,
      sound: "default",
      title,
      body,
      data,
    }));

    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(chunk),
      });
    }
  } catch (err) {
    logger.error("Error sending push notifications", { error: err.message, stack: err.stack });
  }
}

export default function registerSocketHandlers(io) {
  io.use((socket, next) => {
    const req = {
      headers: {
        authorization: `Bearer ${socket.handshake.auth.token}`,
      },
    };
    // Fake res — converts Express-style 401 responses into socket errors
    const res = {
      status(code) {
        return {
          json(body) {
            return next(new Error(body?.message || "Unauthorized"));
          },
        };
      },
    };
    authenticateToken(req, res, (err) => {
      if (err) return next(new Error("Unauthorized"));
      socket.user = req.user;
      next();
    });
  });

  io.on("connection", (socket) => {
    logger.info("Socket connected", { socketId: socket.id });

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
        logger.error("join_list error", { error: err.message, stack: err.stack });
      }
    });

    socket.on("send_item", async (data) => {
      const validated = parseSocketPayload(socket, sendItemSchema, data);
      if (!validated) return;
      const { listId, itemName, price, storeName, quantity, productId } =
        validated;
      const addby = socket.user.id;

      try {
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
              "פריט חדש ברשימה",
              `${adderName || "Someone"} הוסיף ${itemName}`,
              {
                type: "item_added",
                listId,
              },
            );
          }
        } catch (pushErr) {
          logger.error("Push notification error", { error: pushErr.message, stack: pushErr.stack });
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
          logger.error("Error saving item", { error: e.message, stack: e.stack });
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
        logger.warn("Delete error", { error: err.message, stack: err.stack });
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
        logger.error("Mark paid error", { error: err.message, stack: err.stack });
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
        logger.error("Unmark paid error", { error: err.message, stack: err.stack });
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
        logger.error("Update quantity error", { error: err.message, stack: err.stack });
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
        logger.error("Update note error", { error: err.message, stack: err.stack });
      }
    });

    socket.on("create_list", async (list, callback) => {
      const validated = parseSocketPayload(
        socket,
        createListSchema,
        list,
        callback,
      );
      if (!validated) return;
      const { list_name } = validated;
      // Always use the authenticated user — never trust client-supplied userId
      const userId = socket.user.id;

      try {
        await assertNotChild(userId);

        const listRes = await db.query(
          "INSERT INTO app.list (list_name) VALUES ($1) RETURNING id",
          [list_name],
        );
        const newListId = listRes.rows[0].id;

        await db.query(
          "INSERT INTO app.list_members (list_id, user_id, status) VALUES ($1, $2, $3)",
          [newListId, userId, "admin"],
        );

        callback({ success: true, listId: newListId });
      } catch (e) {
        if (e.code === "IS_CHILD") {
          return callback({
            success: false,
            error: "Child accounts cannot create lists",
          });
        }
        if (e.code === "USER_NOT_FOUND") {
          return callback({ success: false, error: "User not found" });
        }
        logger.error("Create list error", { error: e.message, stack: e.stack });
        callback({ success: false, error: "Database error" });
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
        logger.error("Add comment error", { error: err.message, stack: err.stack });
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
        logger.error("Chat message error", { error: err.message, stack: err.stack });
      }
    });

    socket.on("assign_item", async (data) => {
      const validated = parseSocketPayload(socket, assignItemSchema, data);
      if (!validated) return;
      const { itemId, listId, assignedTo } = validated;
      try {
        await assertMember(listId, socket.user.id);
        const res = await db.query(
          `WITH updated AS (
             UPDATE app.list_items
                SET assigned_to = $1
              WHERE id = $2 AND listid = $3
              RETURNING 1
           )
           SELECT CASE WHEN $1::int IS NOT NULL
                    THEN (SELECT first_name FROM app2.users WHERE id = $1)
                  END AS assigned_to_name
             FROM updated`,
          [assignedTo, itemId, listId],
        );
        const assignedToName = res.rows[0]?.assigned_to_name ?? null;

        io.to(String(listId)).emit("item_assigned", {
          itemId,
          assignedTo,
          assignedToName,
        });
      } catch (err) {
        logger.error("Assign item error", { error: err.message, stack: err.stack });
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
        await assertMember(listId, socket.user.id);
      } catch (err) {
        return callback?.({ success: false, error: "Not a member" });
      }

      const client = await db.connect();
      try {
        await client.query("BEGIN");
        for (const item of items) {
          await client.query(
            "UPDATE app.list_items SET sort_order = $1 WHERE id = $2 AND listid = $3",
            [item.sortOrder, item.itemId, listId],
          );
        }
        await client.query("COMMIT");
        socket.to(String(listId)).emit("items_reordered", { items });
        callback?.({ success: true });
      } catch (err) {
        if (err.message === "Not a member") {
          return callback?.({ success: false, error: "Not a member" });
        }
        logger.error("Reorder assertMember error", { error: err.message, stack: err.stack });
        return callback?.({ success: false, error: "Server error" });
      } finally {
        client.release();
      }
    });
  });
}
