import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import assertMember from "../utils/assertmember.js";
import db from "../utils/db.js";
import { logger } from "../utils/logger.js";

const router = Router();
router.use(authenticateToken);

/**
 * GET /api/templates
 * List the current user's templates with item counts.
 */
router.get("/", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT t.id, t.template_name, t.source_list_id, t.created_at,
              COALESCE(ti.item_count, 0) AS item_count
       FROM app.list_templates t
       LEFT JOIN (
         SELECT template_id, COUNT(*)::int AS item_count
         FROM app.template_items
         GROUP BY template_id
       ) ti ON ti.template_id = t.id
       WHERE t.user_id = $1
       ORDER BY t.created_at DESC`,
      [req.userId],
    );
    return res.json({ templates: result.rows });
  } catch (err) {
    logger.error("Error fetching templates", {
      error: err.message,
      stack: err.stack,
    });
    return res.status(500).json({ message: "Error fetching templates" });
  }
});

/**
 * POST /api/templates
 * Save the current items of a list as a new template owned by the caller.
 * Body: { listId, templateName }
 */
router.post("/", async (req, res) => {
  const { templateName } = req.body;
  // Coerce listId from the body to an int and round-trip-validate it.
  // Previously a non-numeric value got handed straight to assertMember's
  // SQL, surfacing as a 500 with a pg "invalid input syntax for type
  // integer" error in the response body.
  const listIdRaw = req.body.listId;
  const listId = Number(listIdRaw);
  if (
    !Number.isInteger(listId) ||
    listId <= 0 ||
    String(listId) !== String(listIdRaw)
  ) {
    return res.status(400).json({ message: "Invalid listId" });
  }
  if (!templateName || !templateName.trim()) {
    return res.status(400).json({ message: "Template name is required" });
  }

  try {
    await assertMember(listId, req.userId);

    const t = await db.query(
      `INSERT INTO app.list_templates (user_id, template_name, source_list_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [req.userId, templateName.trim(), listId],
    );
    const templateId = t.rows[0].id;

    await db.query(
      `INSERT INTO app.template_items (template_id, item_name, quantity, note, sort_order)
       SELECT $1, itemname, quantity, note, COALESCE(sort_order, 0)
       FROM app.list_items
       WHERE listid = $2`,
      [templateId, listId],
    );

    return res.status(201).json({ templateId });
  } catch (err) {
    if (err.message === "Not a member") {
      return res.status(403).json({ message: "Not a member of this list" });
    }
    logger.error("Error saving template", {
      error: err.message,
      stack: err.stack,
    });
    return res.status(500).json({ message: "Error saving template" });
  }
});

/**
 * POST /api/templates/:id/apply
 * Create a new list from the given template, with the caller as admin.
 * Body: { listName }
 * Returns: { listId }
 */
router.post("/:id/apply", async (req, res) => {
  const templateId = parseInt(req.params.id, 10);
  const { listName } = req.body;
  if (!Number.isInteger(templateId)) {
    return res.status(400).json({ message: "Invalid template id" });
  }
  if (!listName || !listName.trim()) {
    return res.status(400).json({ message: "List name is required" });
  }

  // The list + members + items inserts have to land together: if the items
  // copy fails after the first two succeed, the caller ends up with an
  // orphan empty list owned by them. Wrap the whole apply in a transaction.
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const t = await client.query(
      "SELECT id FROM app.list_templates WHERE id = $1 AND user_id = $2",
      [templateId, req.userId],
    );
    if (t.rows.length === 0) {
      return res.status(404).json({ message: "Template not found" });
    }
    const listRes = await client.query(
      "INSERT INTO app.list (list_name) VALUES ($1) RETURNING id",
      [listName.trim()],
    );
    const newListId = listRes.rows[0].id;

    await client.query(
      "INSERT INTO app.list_members (list_id, user_id, status) VALUES ($1, $2, 'admin')",
      [newListId, req.userId],
    );

    await client.query(
      `INSERT INTO app.list_items (listid, itemname, quantity, note, sort_order, addby, addat, updatedat)
       SELECT $1, item_name, quantity, note, COALESCE(sort_order, 0), $2, NOW(), NOW()
       FROM app.template_items
       WHERE template_id = $3`,
      [newListId, req.userId, templateId],
    );

    await client.query("COMMIT");
    return res.json({ listId: newListId });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error("Error applying template", {
      error: err.message,
      stack: err.stack,
    });
    return res.status(500).json({ message: "Error applying template" });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/templates/:id
 * Delete a template owned by the caller. Cascades to template_items.
 */
router.delete("/:id", async (req, res) => {
  const templateId = parseInt(req.params.id, 10);
  if (!Number.isInteger(templateId)) {
    return res.status(400).json({ message: "Invalid template id" });
  }

  try {
    const result = await db.query(
      "DELETE FROM app.list_templates WHERE id = $1 AND user_id = $2 RETURNING id",
      [templateId, req.userId],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Template not found" });
    }
    return res.json({ success: true });
  } catch (err) {
    logger.error("Error deleting template", {
      error: err.message,
      stack: err.stack,
    });
    return res.status(500).json({ message: "Error deleting template" });
  }
});

export default router;
