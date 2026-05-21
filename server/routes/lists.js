import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import crypto from "crypto";
import assertMember from "../utils/assertmember.js";
import { logger } from "../utils/logger.js";
import db from "../utils/db.js";
import logActivity from "../utils/logActivity.js";
import comparePrices from "../utils/priceCompare.js";
import { addItem, reorderItems } from "../services/listItems.js";
import { messages } from "../utils/messages.js";

const router = Router();
router.use(authenticateToken);

// Validate every numeric path param up front. pg would coerce the string for us
// and throw on garbage like "1;SELECT 1--", but that surfaces as a 500 with a
// driver error in the response body when NODE_ENV isn't strict. Catch it here
// and return a clean 400 instead. Mutates req.params.<name> to a number so
// downstream handlers don't have to.
function intParam(name) {
  return (req, res, next, value) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0 || String(n) !== String(value)) {
      return res.status(400).json({ message: `Invalid ${name}` });
    }
    req.params[name] = n;
    next();
  };
}
router.param("id", intParam("id"));
router.param("listId", intParam("listId"));
router.param("itemId", intParam("itemId"));

/**
 * GET /api/lists
 * Get all lists for authenticated user
 */
router.get("/", async (req, res) => {
  try {
    // item_count + member_count via grouped LEFT JOINs (same shape as the
    // templates listing query). The frontend renders these straight into the
    // list cards; without them every card said "undefined פריטים" /
    // "undefined חברים" on first page load.
    const { rows } = await db.query(
      `SELECT l.id, l.list_name, l.status, l.created_at, l.updated_at,
              lm.status AS role,
              COALESCE(li_count.item_count, 0)   AS item_count,
              COALESCE(mem_count.member_count, 0) AS member_count
       FROM app.list l
       JOIN app.list_members lm ON lm.list_id = l.id
       LEFT JOIN (
         SELECT listid, COUNT(*)::int AS item_count
         FROM app.list_items
         GROUP BY listid
       ) li_count ON li_count.listid = l.id
       LEFT JOIN (
         SELECT list_id, COUNT(*)::int AS member_count
         FROM app.list_members
         GROUP BY list_id
       ) mem_count ON mem_count.list_id = l.id
       WHERE lm.user_id = $1
       ORDER BY l.updated_at DESC`,
      [req.userId],
    );
    return res.json({ lists: rows });
  } catch (err) {
    if (err.message === "Not a member") {
      return res.status(403).json({ message: "Not a member of this list" });
    }
    logger.error("Error fetching lists", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Error fetching lists" });
  }
});

/**
 * GET /api/lists/:id/items
 * Get list details + items + members + user role
 */
router.get("/:id/items", async (req, res) => {
  const listId = req.params.id;
  try {
    await assertMember(listId, req.userId);
    const listRes = await db.query(
      "SELECT id, list_name, status, created_at, updated_at FROM app.list WHERE id = $1",
      [listId],
    );
    if (listRes.rows.length === 0) {
      return res.status(404).json({ message: "List not found" });
    }

    const itemsRes = await db.query(
      `SELECT li.id, li.listid, li.itemname, li.price, li.storename, li.quantity,
              li.addby, li.addat, li.updatedat, li.product_id, li.sort_order,
              li.is_checked, li.checked_by, li.paid_by, li.paid_at,
              li.note, li.note_by, li.assigned_to,
              u.first_name AS paid_by_name, u2.first_name AS note_by_name,
              u3.first_name AS added_by_name, u4.first_name AS checked_by_name,
              u5.first_name AS assigned_to_name
       FROM app.list_items li
       LEFT JOIN app2.users u ON li.paid_by = u.id
       LEFT JOIN app2.users u2 ON li.note_by = u2.id
       LEFT JOIN app2.users u3 ON li.addby = u3.id
       LEFT JOIN app2.users u4 ON li.checked_by = u4.id
       LEFT JOIN app2.users u5 ON li.assigned_to = u5.id
       WHERE li.listid = $1
       ORDER BY CASE WHEN li.sort_order > 0 THEN li.sort_order ELSE 999999 END ASC, li.addat DESC`,
      [listId],
    );

    const membersRes = await db.query(
      `SELECT u.id, u.first_name, u.last_name, lm.status AS role
       FROM app.list_members lm
       JOIN app2.users u ON lm.user_id = u.id
       WHERE lm.list_id = $1`,
      [listId],
    );
    const userMember = membersRes.rows.find((m) => m.id === req.userId);

    return res.json({
      list: listRes.rows[0],
      items: itemsRes.rows,
      members: membersRes.rows,
      userRole: userMember?.role,
    });
  } catch (err) {
    if (err.message === "Not a member") {
      return res.status(403).json({ message: "Not a member of this list" });
    }
    logger.error("Error fetching list details", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Error fetching list details" });
  }
});

/**
 * POST /api/lists/:id/items
 * Add item to list (parents/regular users only - children must use /api/family/kid-requests)
 */
router.post("/:id/items", async (req, res) => {
  const listId = req.params.id;
  const { itemName, price, storeName, quantity, productId } = req.body;

  if (!itemName || itemName.trim() === "") {
    return res.status(400).json({ message: "Item name is required" });
  }
  try {
    const { newItem } = await addItem({
      listId,
      userId: req.userId,
      itemName,
      price: price || null,
      storeName: storeName || null,
      quantity: quantity || 1,
      productId: productId || null,
    });

    const io = req.app.locals.io;
    if (io) {
      io.to(String(listId)).emit("receive_item", newItem);
    }

    await logActivity(
      listId,
      req.userId,
      "item_added",
      `Added item: ${itemName}`,
    );

    return res.status(201).json({ item: newItem });
  } catch (err) {
    if (err.message === "Not a member") {
      return res.status(403).json({ message: "Not a member of this list" });
    }
    if (err.code === "IS_CHILD") {
      return res.status(403).json({
        message: messages.child_cannot_add_item,
        isChild: true,
      });
    }
    if (err.code === "USER_NOT_FOUND") {
      return res.status(404).json({ message: "User not found" });
    }
    logger.error("Error adding item", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Error adding item" });
  }
});

/**
 * DELETE /api/lists/:id
 * Delete a list (admin only)
 */
router.delete("/:id", async (req, res) => {
  const listId = req.params.id;

  try {
    // One query covers both membership and role. Avoids the assertMember +
    // separate-SELECT race that could crash on memberRes.rows[0] if membership
    // was revoked in between, and saves a round-trip.
    const memberRes = await db.query(
      "SELECT status FROM app.list_members WHERE list_id = $1 AND user_id = $2",
      [listId, req.userId],
    );

    if (memberRes.rows.length === 0) {
      return res.status(403).json({ message: "Not a member of this list" });
    }
    if (memberRes.rows[0].status !== "admin") {
      return res
        .status(403)
        .json({ message: "Only admin can delete the list" });
    }

    await db.query("DELETE FROM app.list WHERE id = $1", [listId]);

    return res.json({ success: true, message: "List deleted successfully" });
  } catch (err) {
    logger.error("Error deleting list", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Error deleting list" });
  }
});

/**
 * POST /api/lists/:id/leave
 * Leave a list (members only, not admin)
 */
router.post("/:id/leave", async (req, res) => {
  const listId = req.params.id;

  try {
    // One query covers membership + role; mirrors the DELETE /:id pattern.
    const memberRes = await db.query(
      "SELECT status FROM app.list_members WHERE list_id = $1 AND user_id = $2",
      [listId, req.userId],
    );

    if (memberRes.rows.length === 0) {
      return res.status(403).json({ message: "Not a member of this list" });
    }
    if (memberRes.rows[0].status === "admin") {
      return res.status(403).json({
        message:
          "Admin cannot leave the list. Delete it or transfer admin role first.",
      });
    }

    await db.query(
      "DELETE FROM app.list_members WHERE list_id = $1 AND user_id = $2",
      [listId, req.userId],
    );

    return res.json({ success: true, message: "Left list successfully" });
  } catch (err) {
    logger.error("Error leaving list", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Error leaving list" });
  }
});

/**
 * GET /api/lists/:id/compare
 * Price comparison across chains
 */
router.get("/:id/compare", async (req, res) => {
  const listId = req.params.id;

  try {
    await assertMember(listId, req.userId);
    const payload = await comparePrices(db, listId);
    return res.json(payload);
  } catch (err) {
    if (err.message === "Not a member") {
      return res.status(403).json({ message: "Not a member of this list" });
    }
    logger.error("Error comparing prices", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Error comparing prices" });
  }
});

/**
 * POST /api/lists/:id/invite
 * Generate invite link
 */
router.post("/:id/invite", async (req, res) => {
  const listId = req.params.id;

  try {
    const memberRes = await db.query(
      "SELECT status FROM app.list_members WHERE list_id = $1 AND user_id = $2",
      [listId, req.userId],
    );

    if (memberRes.rows.length === 0) {
      return res.status(403).json({ message: "Not a member of this list" });
    }
    if (memberRes.rows[0].status !== "admin") {
      return res
        .status(403)
        .json({ message: "Only admins can create invites" });
    }

    const inviteCode = crypto.randomBytes(16).toString("hex");

    await db.query(
      `INSERT INTO app.list_invites (list_id, invite_code, created_by, expires_at)
       VALUES ($1, $2, $3, NOW() + interval '7 days')`,
      [listId, inviteCode, req.userId],
    );

    // The frontend route is `/join/:inviteCode` (App.jsx). The link used to
    // say `/invite/:inviteCode`, which fell through to the home page via the
    // SPA fallback — the invite UX shipped with two halves that didn't talk
    // to each other.
    const host = process.env.FRONTEND_URL || "http://localhost:5173";
    return res.json({ inviteLink: `${host}/join/${inviteCode}` });
  } catch (err) {
    logger.warn("Error creating invite", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Error creating invite" });
  }
});

/**
 * POST /api/lists/join/:inviteCode
 *
 * Redeem an invite code: validate it (exists / active / not expired / not
 * over its use cap), add the caller to the list as a member, and bump the
 * use_count. Previously no consumer endpoint existed for the codes minted
 * above — the entire invite/join flow was dead because the server had no
 * route reading from app.list_invites. JoinList.jsx now hits this URL.
 */
router.post("/join/:inviteCode", async (req, res) => {
  const { inviteCode } = req.params;
  if (
    typeof inviteCode !== "string" ||
    !/^[A-Za-z0-9-]{1,128}$/.test(inviteCode)
  ) {
    return res.status(400).json({ message: "Invalid invite code" });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // FOR UPDATE OF i — lock only the invite row, not the joined list row.
    // The list row doesn't need protection here; locking it would block
    // any other operation against the list during this transaction for no
    // reason. Tiny perf nit on a low-traffic endpoint.
    const inviteRes = await client.query(
      `SELECT i.list_id, i.max_uses, i.use_count, i.is_active, i.expires_at,
              l.list_name
       FROM app.list_invites i
       JOIN app.list l ON l.id = i.list_id
       WHERE i.invite_code = $1
       FOR UPDATE OF i`,
      [inviteCode],
    );
    if (inviteRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Invite not found" });
    }
    const invite = inviteRes.rows[0];
    if (!invite.is_active) {
      await client.query("ROLLBACK");
      return res.status(410).json({ message: "Invite is no longer active" });
    }
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      await client.query("ROLLBACK");
      return res.status(410).json({ message: "Invite has expired" });
    }
    if (
      invite.max_uses != null &&
      invite.use_count >= invite.max_uses
    ) {
      await client.query("ROLLBACK");
      return res.status(410).json({ message: "Invite has been used up" });
    }

    // Only bump use_count when the INSERT actually adds a new membership.
    // Without this, the same user reloading the join page eats `max_uses`
    // one redemption at a time — a single clumsy admin could exhaust a
    // max_uses=5 invite with one user pressing refresh five times.
    const inserted = await client.query(
      `INSERT INTO app.list_members (list_id, user_id, status)
       VALUES ($1, $2, 'member')
       ON CONFLICT (list_id, user_id) DO NOTHING
       RETURNING id`,
      [invite.list_id, req.userId],
    );

    if (inserted.rowCount > 0) {
      await client.query(
        "UPDATE app.list_invites SET use_count = use_count + 1 WHERE invite_code = $1",
        [inviteCode],
      );
    }

    await client.query("COMMIT");
    return res.json({ listId: invite.list_id, listName: invite.list_name });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error("Error joining list via invite", {
      error: err.message,
      stack: err.stack,
    });
    return res.status(500).json({ message: "Error joining list" });
  } finally {
    client.release();
  }
});

/**
 * GET /api/lists/:id/chat
 * Get chat messages for a list
 */
router.get("/:id/chat", async (req, res) => {
  const listId = req.params.id;
  const limitRaw = parseInt(req.query.limit, 10);
  const limit = Math.min(
    Number.isInteger(limitRaw) && limitRaw > 0 ? limitRaw : 50,
    100,
  );
  const beforeIdRaw = parseInt(req.query.before_id, 10);
  const beforeId = Number.isInteger(beforeIdRaw) && beforeIdRaw > 0 ? beforeIdRaw : null;

  try {
    await assertMember(listId, req.userId);
    // Cursor pagination on lc.id (monotonic). Fetch limit+1 to know if there
    // are more older messages without an extra COUNT query.
    const params = [listId];
    let cursorClause = "";
    if (beforeId !== null) {
      params.push(beforeId);
      cursorClause = ` AND lc.id < $${params.length}`;
    }
    params.push(limit + 1);
    const result = await db.query(
      `SELECT lc.id, lc.list_id AS "listId", lc.user_id AS "userId", u.first_name AS "firstName",
              lc.message, lc.created_at AS "createdAt"
       FROM app.list_chat lc
       JOIN app2.users u ON lc.user_id = u.id
       WHERE lc.list_id = $1${cursorClause}
       ORDER BY lc.id DESC
       LIMIT $${params.length}`,
      params,
    );
    const hasMore = result.rows.length > limit;
    const page = hasMore ? result.rows.slice(0, limit) : result.rows;
    // Client renders oldest-first.
    const messages = page.slice().reverse();
    // Cursor for fetching the next (older) page is the smallest id we returned.
    const nextBeforeId = page.length > 0 ? page[page.length - 1].id : null;
    return res.json({ messages, hasMore, nextBeforeId });
  } catch (err) {
    if (err.message === "Not a member") {
      return res.status(403).json({ message: "Not a member of this list" });
    }
    logger.error("Error fetching chat messages", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Error fetching chat messages" });
  }
});

/**
 * GET /api/lists/:id/activity
 * Get activity log for a list
 */
router.get("/:id/activity", async (req, res) => {
  const listId = req.params.id;

  try {
    await assertMember(listId, req.userId);
    const result = await db.query(
      `SELECT al.id, al.list_id, al.user_id, al.action, al.details, al.created_at,
              u.first_name
       FROM app.activity_log al
       LEFT JOIN app2.users u ON al.user_id = u.id
       WHERE al.list_id = $1
       ORDER BY al.created_at DESC
       LIMIT 50`,
      [listId],
    );
    return res.json({ activities: result.rows });
  } catch (err) {
    logger.error("Error fetching activity log", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Error fetching activity log" });
  }
});

/**
 * PUT /api/lists/:id/reorder
 * Reorder list items
 */
router.put("/:id/reorder", async (req, res) => {
  const listId = req.params.id;
  const { items } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "items array is required" });
  }

  try {
    await reorderItems({ listId, userId: req.userId, items });
    res.json({ success: true });
  } catch (err) {
    if (err.message === "Not a member") {
      return res.status(403).json({ message: "Not a member of this list" });
    }
    logger.error("Error reordering items", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Error reordering items" });
  }
});

/**
 * GET /api/lists/:listId/items/:itemId/comments
 * Get comments for an item
 */
router.get("/:listId/items/:itemId/comments", async (req, res) => {
  const { listId, itemId } = req.params;

  try {
    await assertMember(listId, req.userId);
    const result = await db.query(
      `SELECT c.id, c.item_id, c.user_id, c.comment, c.created_at, u.first_name
       FROM app.list_item_comments c
       JOIN app2.users u ON c.user_id = u.id
       WHERE c.item_id = $1
       ORDER BY c.created_at ASC`,
      [itemId],
    );

    res.json({ comments: result.rows });
  } catch (err) {
    if (err.message === "Not a member") {
      return res.status(403).json({ message: "Not a member of this list" });
    }
    logger.error("Error fetching comments", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Error fetching comments" });
  }
});

export default router;
