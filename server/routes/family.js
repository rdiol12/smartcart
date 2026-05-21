import { Router } from "express";
import bcrypt from "bcrypt";
import { authenticateToken } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";
import db from "../utils/db.js";

const router = Router();
const saltRounds = 10;
router.use(authenticateToken);

/**
 * POST /api/family/create-child
 * Create child account (parent only)
 */
router.post("/create-child", async (req, res) => {
  const { firstName, username, password } = req.body;

  try {
    if (!firstName || !username || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (password.length < 6) {
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters" });
    }

    // Check if requesting user is a child (prevent grandchildren)
    const requestingUser = await db.query(
      "SELECT parent_id FROM app2.users WHERE id = $1",
      [req.userId],
    );

    if (requestingUser.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    if (requestingUser.rows[0].parent_id !== null) {
      return res
        .status(403)
        .json({ message: "Child accounts cannot create other children" });
    }

    // Check if username already exists
    const existing = await db.query(
      "SELECT id FROM app2.users WHERE username = $1",
      [username],
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ message: "Username already taken" });
    }

    // Hash password and create child account
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const result = await db.query(
      `INSERT INTO app2.users (first_name, username, password_hash, parent_id, email)
       VALUES ($1, $2, $3, $4, NULL)
       RETURNING id, first_name, username`,
      [firstName, username, hashedPassword, req.userId],
    );

    return res.status(201).json({ child: result.rows[0] });
  } catch (err) {
    logger.error("Error creating child account", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Error creating child account" });
  }
});

/**
 * GET /api/family/debug-user
 * Debug endpoint to check current user
 */
if (process.env.NODE_ENV === "development") {
  router.get("/debug-user", async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT id, email, username, first_name, parent_id FROM app2.users WHERE id = $1`,
        [req.userId],
      );
      const children = await db.query(
        `SELECT id, first_name, username FROM app2.users WHERE parent_id = $1`,
        [req.userId],
      );
      return res.json({
        currentUser: rows[0],
        userId: req.userId,
        children: children.rows,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
}

/**
 * GET /api/family/children
 * Get parent's children
 */
router.get("/children", async (req, res) => {

  try {
    const { rows } = await db.query(
      `SELECT id, first_name, username, created_at
       FROM app2.users
       WHERE parent_id = $1
       ORDER BY created_at DESC`,
      [req.userId],
    );
    return res.json({ children: rows });
  } catch (err) {
    logger.error("Error fetching children", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Error fetching children" });
  }
});

/**
 * DELETE /api/family/delete-child/:childId
 * Delete child account
 */
router.delete("/delete-child/:childId", async (req, res) => {
  const childId = req.params.childId;

  try {
    // Verify the child belongs to this parent
    const child = await db.query(
      "SELECT id FROM app2.users WHERE id = $1 AND parent_id = $2",
      [childId, req.userId],
    );

    if (child.rows.length === 0) {
      return res
        .status(403)
        .json({ message: "Unauthorized or child not found" });
    }

    // Delete the child account (cascade will handle related data)
    await db.query("DELETE FROM app2.users WHERE id = $1", [childId]);

    return res.json({ message: "Child account deleted" });
  } catch (err) {
    logger.error("Error deleting child account", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Error deleting child account" });
  }
});

/**
 * GET /api/lists/:id/children
 * Get parent's children with membership status for a list
 */
router.get("/lists/:id/children", async (req, res) => {
  const listId = req.params.id;

  try {
    const { rows } = await db.query(
      `SELECT u.id, u.first_name, u.username,
              CASE WHEN lm.id IS NOT NULL THEN true ELSE false END AS is_member
       FROM app2.users u
       LEFT JOIN app.list_members lm ON lm.list_id = $1 AND lm.user_id = u.id
       WHERE u.parent_id = $2`,
      [listId, req.userId],
    );
    return res.json({ children: rows });
  } catch (err) {
    logger.error("Error fetching children for list", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Error fetching children" });
  }
});

/**
 * POST /api/lists/:id/children/:childId
 * Add child to list
 */
router.post("/lists/:id/children/:childId", async (req, res) => {
  const { id: listId, childId } = req.params;

  try {
    // Verify child belongs to this parent
    const child = await db.query(
      "SELECT id FROM app2.users WHERE id = $1 AND parent_id = $2",
      [childId, req.userId],
    );

    if (child.rows.length === 0) {
      return res.status(403).json({ message: "Not your child" });
    }

    await db.query(
      `INSERT INTO app.list_members (list_id, user_id, status) VALUES ($1, $2, 'member')
       ON CONFLICT (list_id, user_id) DO NOTHING`,
      [listId, childId],
    );

    return res.json({ success: true });
  } catch (err) {
    logger.error("Error adding child to list", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Error adding child" });
  }
});

/**
 * DELETE /api/lists/:id/children/:childId
 * Remove child from list
 */
router.delete("/lists/:id/children/:childId", async (req, res) => {
  const { id: listId, childId } = req.params;

  try {
    const child = await db.query(
      "SELECT id FROM app2.users WHERE id = $1 AND parent_id = $2",
      [childId, req.userId],
    );

    if (child.rows.length === 0) {
      return res.status(403).json({ message: "Not your child" });
    }

    await db.query(
      "DELETE FROM app.list_members WHERE list_id = $1 AND user_id = $2",
      [listId, childId],
    );

    return res.json({ success: true });
  } catch (err) {
    logger.error("Error removing child from list", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Error removing child" });
  }
});

/**
 * GET /api/kid-requests/pending
 * Get pending requests for parent
 */
router.get("/kid-requests/pending", async (req, res) => {

  try {
    const result = await db.query(
      `SELECT
        kr.id,
        kr.item_name,
        kr.price,
        kr.quantity,
        kr.product_id,
        kr.created_at,
        u.first_name as child_first_name,
        l.list_name
       FROM app2.kid_requests kr
       JOIN app2.users u ON u.id = kr.child_id
       JOIN app.list l ON l.id = kr.list_id
       WHERE kr.parent_id = $1 AND kr.status = 'pending'
       ORDER BY kr.created_at DESC`,
      [req.userId],
    );
    return res.json({ requests: result.rows });
  } catch (err) {
    logger.error("Error fetching kid requests", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Error fetching requests" });
  }
});

/**
 * GET /api/kid-requests/my
 * Get child's own request history
 */
router.get("/kid-requests/my", async (req, res) => {

  try {
    const result = await db.query(
      `SELECT
        kr.id,
        kr.item_name,
        kr.price,
        kr.quantity,
        kr.status,
        kr.created_at,
        kr.product_id,
        l.list_name
       FROM app2.kid_requests kr
       LEFT JOIN app.list l ON l.id = kr.list_id
       WHERE kr.child_id = $1
       ORDER BY kr.created_at DESC`,
      [req.userId],
    );
    return res.json({ requests: result.rows });
  } catch (err) {
    logger.error("Error fetching my requests", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Error fetching requests" });
  }
});

/**
 * POST /api/kid-requests
 * Child requests to add item
 */
router.post("/kid-requests", async (req, res) => {
  const { listId, itemName, price, storeName, quantity, productId } = req.body;
  const io = req.app.locals.io;

  try {
    // Get the child's parent and child info
    const userRes = await db.query(
      "SELECT parent_id, first_name FROM app2.users WHERE id = $1",
      [req.userId],
    );

    if (userRes.rows.length === 0 || !userRes.rows[0].parent_id) {
      return res.status(403).json({ message: "Not a child account" });
    }

    const parentId = userRes.rows[0].parent_id;
    const childName = userRes.rows[0].first_name;

    // Get list name
    const listRes = await db.query(
      "SELECT list_name FROM app.list WHERE id = $1",
      [listId],
    );
    const listName = listRes.rows[0]?.list_name || "רשימה";

    const result = await db.query(
      `INSERT INTO app2.kid_requests (child_id, parent_id, list_id, item_name, price, store_name, quantity, product_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        req.userId,
        parentId,
        listId,
        itemName,
        price,
        storeName,
        quantity || 1,
        productId || null,
      ],
    );

    const requestId = result.rows[0].id;

    // Emit real-time notification to parent
    if (io) {
      io.to(`user_${parentId}`).emit("new_kid_request", {
        id: requestId,
        requestId: requestId,
        childName: childName,
        child_first_name: childName,
        itemName: itemName,
        item_name: itemName,
        listName: listName,
        list_name: listName,
        quantity: quantity || 1,
        price: price,
        productId: productId,
        product_id: productId,
      });
    }

    return res.status(201).json({ message: "Request sent" });
  } catch (err) {
    logger.error("Error creating kid request", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Error creating request" });
  }
});

/**
 * POST /api/kid-requests/:id/resolve
 * Approve or reject child request
 */
router.post("/kid-requests/:id/resolve", async (req, res) => {
  const requestId = req.params.id;
  const { action } = req.body;
  const io = req.app.locals.io;

  if (action !== "approve" && action !== "reject") {
    return res.status(400).json({ message: "Invalid action" });
  }

  try {
    const requestResult = await db.query(
      `SELECT kr.*, u.first_name as child_first_name
       FROM app2.kid_requests kr
       JOIN app2.users u ON u.id = kr.child_id
       WHERE kr.id = $1 AND kr.parent_id = $2`,
      [requestId, req.userId],
    );

    if (requestResult.rows.length === 0) {
      return res.status(403).json({ message: "Not your child's request" });
    }

    const request = requestResult.rows[0];
    const newStatus = action === "approve" ? "approved" : "rejected";

    await db.query("UPDATE app2.kid_requests SET status = $1 WHERE id = $2", [
      newStatus,
      requestId,
    ]);

    // If approved, add the item to the list
    if (action === "approve") {
      const itemResult = await db.query(
        `INSERT INTO app.list_items (listId, itemName, price, storeName, quantity, addby, addat, updatedat, product_id)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), $7)
         RETURNING *`,
        [
          request.list_id,
          request.item_name,
          request.price || null,
          request.store_name || null,
          request.quantity || 1,
          request.child_id,
          request.product_id || null,
        ],
      );

      // Emit to list room
      if (io) {
        io.to(String(request.list_id)).emit("receive_item", itemResult.rows[0]);
      }
    }

    // Notify the child
    if (io) {
      io.to(`user_${request.child_id}`).emit("request_resolved", {
        requestId: requestId,
        status: newStatus,
      });
    }

    return res.json({
      success: true,
      message: action === "approve" ? "Request approved" : "Request rejected",
    });
  } catch (err) {
    logger.error("Error resolving request", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Error resolving request" });
  }
});

export default router;
