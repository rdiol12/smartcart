import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import assertMember from "../utils/assertmember.js";
import db from "../utils/db.js";
import { logger } from "../utils/logger.js";

const router = Router();
router.use(authenticateToken);

// Cache for templates (TTL: 1 minute)
const templatesCache = new Map();
const CACHE_TTL = 60 * 1000; // 1 minute

const clearTemplatesCache = (userId) => {
  templatesCache.delete(`templates_${userId}`);
};

/**
 * GET /api/templates
 * List the current user's templates with item counts.
 */
router.get("/", async (req, res) => {
  const cacheKey = `templates_${req.userId}`;

  // Check cache
  const cached = templatesCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return res.json({ templates: cached.data });
  }

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

    // Cache the result
    templatesCache.set(cacheKey, {
      data: result.rows,
      timestamp: Date.now(),
    });

    return res.json({ templates: result.rows });
  } catch (err) {
    logger.error("Error fetching templates", {
      error: err.message,
      stack: err.stack,
      userId: req.userId,
    });
    return res.status(500).json({ message: "Error fetching templates" });
  }
});

/**
 * GET /api/templates/:id
 * Get a specific template with its items (new endpoint)
 */
router.get("/:id", async (req, res) => {
  const templateId = parseInt(req.params.id, 10);
  if (!Number.isInteger(templateId) || templateId <= 0) {
    return res.status(400).json({ message: "Invalid template id" });
  }

  const cacheKey = `template_${templateId}_${req.userId}`;

  // Check cache
  const cached = templatesCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return res.json({ template: cached.data });
  }

  try {
    // Verify ownership
    const templateResult = await db.query(
      `SELECT t.id, t.template_name, t.source_list_id, t.created_at,
              COALESCE(ti.item_count, 0) AS item_count
       FROM app.list_templates t
       LEFT JOIN (
         SELECT template_id, COUNT(*)::int AS item_count
         FROM app.template_items
         GROUP BY template_id
       ) ti ON ti.template_id = t.id
       WHERE t.id = $1 AND t.user_id = $2`,
      [templateId, req.userId],
    );

    if (templateResult.rows.length === 0) {
      return res.status(404).json({ message: "Template not found" });
    }

    // Get template items
    const itemsResult = await db.query(
      `SELECT id, item_name, quantity, note, sort_order
       FROM app.template_items
       WHERE template_id = $1
       ORDER BY sort_order ASC, id ASC`,
      [templateId],
    );

    const template = {
      ...templateResult.rows[0],
      items: itemsResult.rows,
    };

    // Cache the result
    templatesCache.set(cacheKey, {
      data: template,
      timestamp: Date.now(),
    });

    return res.json({ template });
  } catch (err) {
    logger.error("Error fetching template details", {
      error: err.message,
      stack: err.stack,
      templateId,
      userId: req.userId,
    });
    return res.status(500).json({ message: "Error fetching template details" });
  }
});

/**
 * POST /api/templates
 * Save the current items of a list as a new template owned by the caller.
 * Body: { listId, templateName }
 */
router.post("/", async (req, res) => {
  const { templateName } = req.body;
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

  // Optional: Check for duplicate template name
  const existingCheck = await db.query(
    "SELECT id FROM app.list_templates WHERE user_id = $1 AND template_name ILIKE $2",
    [req.userId, templateName.trim()],
  );

  if (existingCheck.rows.length > 0) {
    return res
      .status(409)
      .json({ message: "A template with this name already exists" });
  }

  const client = await db.connect();
  try {
    await assertMember(listId, req.userId);

    await client.query("BEGIN");

    const t = await client.query(
      `INSERT INTO app.list_templates (user_id, template_name, source_list_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [req.userId, templateName.trim(), listId],
    );
    const templateId = t.rows[0].id;

    await client.query(
      `INSERT INTO app.template_items (template_id, item_name, quantity, note, sort_order)
       SELECT $1, itemname, quantity, note, COALESCE(sort_order, 0)
       FROM app.list_items
       WHERE listid = $2`,
      [templateId, listId],
    );

    await client.query("COMMIT");

    // Clear cache
    clearTemplatesCache(req.userId);

    logger.info("Template created", {
      templateId,
      templateName,
      userId: req.userId,
      sourceListId: listId,
    });

    return res.status(201).json({
      templateId,
      template: {
        id: templateId,
        template_name: templateName.trim(),
        source_list_id: listId,
        item_count: t.rows[0]?.item_count || 0,
      },
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});

    if (err.message === "Not a member") {
      return res.status(403).json({ message: "Not a member of this list" });
    }

    logger.error("Error saving template", {
      error: err.message,
      stack: err.stack,
      userId: req.userId,
      listId,
    });
    return res.status(500).json({ message: "Error saving template" });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/templates/:id
 * Update template name (new endpoint)
 */
router.put("/:id", async (req, res) => {
  const templateId = parseInt(req.params.id, 10);
  const { templateName } = req.body;

  if (!Number.isInteger(templateId) || templateId <= 0) {
    return res.status(400).json({ message: "Invalid template id" });
  }

  if (!templateName || !templateName.trim()) {
    return res.status(400).json({ message: "Template name is required" });
  }

  try {
    const result = await db.query(
      "UPDATE app.list_templates SET template_name = $1 WHERE id = $2 AND user_id = $3 RETURNING id",
      [templateName.trim(), templateId, req.userId],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Template not found" });
    }

    // Clear cache
    clearTemplatesCache(req.userId);
    templatesCache.delete(`template_${templateId}_${req.userId}`);

    return res.json({ success: true, templateName: templateName.trim() });
  } catch (err) {
    logger.error("Error updating template", {
      error: err.message,
      stack: err.stack,
      templateId,
      userId: req.userId,
    });
    return res.status(500).json({ message: "Error updating template" });
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

  if (!Number.isInteger(templateId) || templateId <= 0) {
    return res.status(400).json({ message: "Invalid template id" });
  }

  if (!listName || !listName.trim()) {
    return res.status(400).json({ message: "List name is required" });
  }

  // Optional: Check if list name already exists for this user
  const existingList = await db.query(
    "SELECT id FROM app.list_members lm JOIN app.list l ON l.id = lm.list_id WHERE lm.user_id = $1 AND l.list_name ILIKE $2 LIMIT 1",
    [req.userId, listName.trim()],
  );

  if (existingList.rows.length > 0) {
    return res
      .status(409)
      .json({ message: "You already have a list with this name" });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Verify template ownership
    const t = await client.query(
      "SELECT id FROM app.list_templates WHERE id = $1 AND user_id = $2",
      [templateId, req.userId],
    );

    if (t.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Template not found" });
    }

    // Create new list
    const listRes = await client.query(
      "INSERT INTO app.list (list_name) VALUES ($1) RETURNING id",
      [listName.trim()],
    );
    const newListId = listRes.rows[0].id;

    // Add user as admin
    await client.query(
      "INSERT INTO app.list_members (list_id, user_id, status) VALUES ($1, $2, 'admin')",
      [newListId, req.userId],
    );

    // Copy items from template
    await client.query(
      `INSERT INTO app.list_items (listid, itemname, quantity, note, sort_order, addby, addat, updatedat)
       SELECT $1, item_name, quantity, note, COALESCE(sort_order, 0), $2, NOW(), NOW()
       FROM app.template_items
       WHERE template_id = $3`,
      [newListId, req.userId, templateId],
    );

    await client.query("COMMIT");

    logger.info("Template applied", {
      templateId,
      newListId,
      listName,
      userId: req.userId,
    });

    return res.json({
      listId: newListId,
      listName: listName.trim(),
      itemCount: t.rows[0]?.item_count || 0,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error("Error applying template", {
      error: err.message,
      stack: err.stack,
      templateId,
      userId: req.userId,
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
  if (!Number.isInteger(templateId) || templateId <= 0) {
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

    // Clear cache
    clearTemplatesCache(req.userId);
    templatesCache.delete(`template_${templateId}_${req.userId}`);

    logger.info("Template deleted", { templateId, userId: req.userId });

    return res.json({ success: true });
  } catch (err) {
    logger.error("Error deleting template", {
      error: err.message,
      stack: err.stack,
      templateId,
      userId: req.userId,
    });
    return res.status(500).json({ message: "Error deleting template" });
  }
});

export default router;
