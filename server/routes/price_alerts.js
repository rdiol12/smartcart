import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";
import db from "../utils/db.js";

const router = Router();
router.use(authenticateToken);

router.post("/", async (req, res) => {
  const { itemId, targetPrice } = req.body;
  const userId = req.userId;

  const parsedItemId = parseInt(itemId, 10);
  if (!Number.isInteger(parsedItemId) || parsedItemId <= 0) {
    return res.status(400).json({ message: "Invalid itemId" });
  }
  const parsedPrice = parseFloat(targetPrice);
  if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
    return res.status(400).json({ message: "Invalid targetPrice" });
  }

  try {
    const result = await db.query(
      `INSERT INTO app.price_alerts (user_id, item_id, target_price) VALUES ($1, $2, $3) RETURNING *`,
      [userId, parsedItemId, parsedPrice],
    );
    return res.status(201).json({ alert: result.rows[0] });
  } catch (err) {
    logger.error("Error creating price alert", {
      error: err.message,
      stack: err.stack,
    });
    return res.status(500).json({ message: "Error creating price alert" });
  }
});

router.get("/", async (req, res) => {
  const userId = req.userId;

  try {
    const result = await db.query(
      `SELECT pa.id, pa.item_id, pa.target_price, pa.created_at, i.name AS item_name
       FROM app.price_alerts pa
       JOIN app.items i ON pa.item_id = i.id
       WHERE pa.user_id = $1 AND pa.active = true
       ORDER BY pa.created_at DESC`,
      [userId],
    );
    return res.json({ alerts: result.rows });
  } catch (err) {
    logger.error("Error fetching price alerts", {
      error: err.message,
      stack: err.stack,
    });
    return res.status(500).json({ message: "Error fetching price alerts" });
  }
});

router.delete("/:id", async (req, res) => {
  const alertId = parseInt(req.params.id, 10);
  const userId = req.userId;
  if (!Number.isInteger(alertId) || alertId <= 0) {
    return res.status(400).json({ message: "Invalid alert id" });
  }
  try {
    const result = await db.query(
      `UPDATE app.price_alerts SET active = false WHERE id = $1 AND user_id = $2`,
      [alertId, userId],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Alert not found" });
    }
    return res.json({ success: true });
  } catch (err) {
    logger.error("Error deactivating price alert", {
      error: err.message,
      stack: err.stack,
    });
    return res.status(500).json({ message: "Error deactivating price alert" });
  }
});

export default router;
