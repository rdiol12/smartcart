import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import socket from "../socket";
import ItemNoteEditor from "./ItemNoteEditor";
import ItemComments from "./ItemComments";

// Helper function for consistent colors when no image
const getColorFromString = (str) => {
  if (!str) return "#e2e8f0";
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 70%, 85%)`;
};

const ListItemRow = ({ item, listId }) => {
  const navigate = useNavigate();
  const [showComments, setShowComments] = useState(false);
  const [busy, setBusy] = useState(false);
  const [imageError, setImageError] = useState(false);

  // Safety check - if item is undefined, don't render
  if (!item) {
    console.warn("ListItemRow received undefined item");
    return null;
  }

  const lockBriefly = () => {
    setBusy(true);
    setTimeout(() => setBusy(false), 500);
  };

  const handleToggle = () => {
    if (busy) return;
    lockBriefly();
    socket.emit("toggle_item", {
      itemId: item.id,
      listId,
      isChecked: !item.is_checked,
    });
  };

  const handleDelete = () => {
    if (busy) return;
    if (!window.confirm(`למחוק את "${item.itemname}"?`)) return;
    lockBriefly();
    socket.emit("delete_item", { itemId: item.id, listId });
  };

  const handleMarkPaid = () => {
    if (busy) return;
    lockBriefly();
    if (item.paid_by) {
      socket.emit("unmark_paid", { itemId: item.id, listId });
    } else {
      socket.emit("mark_paid", { itemId: item.id, listId });
    }
  };

  const isPaid = !!item.paid_by;
  const isChecked = item.is_checked || false;
  const showImage = !imageError && item.image_url;

  return (
    <div
      className={`sc-item-row ${isPaid ? "sc-item-paid" : ""} ${isChecked && !isPaid ? "sc-item-checked" : ""}`}
      dir="rtl"
      style={{
        padding: "12px",
        borderBottom: "1px solid var(--sc-border)",
        transition: "all 0.2s ease",
      }}
    >
      <div className="d-flex align-items-center gap-3">
        {/* Checkbox */}
        <input
          type="checkbox"
          className="form-check-input"
          checked={isChecked}
          onChange={handleToggle}
          style={{
            width: "20px",
            height: "20px",
            flexShrink: 0,
            accentColor: "var(--sc-primary)",
          }}
        />

        {/* Product Image */}
        <div style={{ flexShrink: 0 }}>
          {showImage ? (
            <img
              src={item.image_url}
              alt={item.itemname || "Product"}
              style={{
                width: "45px",
                height: "45px",
                objectFit: "contain",
                borderRadius: "6px",
                border: "1px solid #e0e0e0",
                backgroundColor: "#fff",
              }}
              onError={() => setImageError(true)}
            />
          ) : (
            <div
              style={{
                width: "45px",
                height: "45px",
                background: getColorFromString(item.itemname),
                borderRadius: "6px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: "bold",
                color: "#333",
                border: "1px solid #e0e0e0",
              }}
            >
              {item.itemname?.charAt(0) || "?"}
            </div>
          )}
        </div>

        {/* Item info */}
        <div className="flex-grow-1" style={{ minWidth: 0 }}>
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <span
              className="fw-bold"
              style={{
                textDecoration: isChecked || isPaid ? "line-through" : "none",
                color:
                  isChecked || isPaid
                    ? "var(--sc-text-muted)"
                    : "var(--sc-text)",
                fontSize: "0.95rem",
                cursor: item.product_id ? "pointer" : "default",
              }}
              onClick={() =>
                item.product_id && navigate(`/product/${item.product_id}`)
              }
            >
              {item.itemname || "Unknown Item"}
              {item.product_id && (
                <i
                  className="bi bi-box-arrow-up-right ms-1"
                  style={{ fontSize: "0.7rem", opacity: 0.5 }}
                ></i>
              )}
            </span>
            {item.quantity > 1 && (
              <span className="sc-badge sc-badge-muted">x{item.quantity}</span>
            )}
            {item.price && (
              <span className="sc-badge sc-badge-primary">
                ₪{Number(item.price).toFixed(2)}
              </span>
            )}
          </div>

          <div
            className="d-flex flex-wrap gap-2 mt-1"
            style={{ fontSize: "0.78rem" }}
          >
            {item.added_by_name && (
              <span style={{ color: "var(--sc-text-muted)" }}>
                <i className="bi bi-person me-1"></i>
                {item.added_by_name}
              </span>
            )}
            {isPaid && item.paid_by_name && (
              <span style={{ color: "var(--sc-success)", fontWeight: 600 }}>
                <i className="bi bi-check-circle me-1"></i>שולם ע"י{" "}
                {item.paid_by_name}
              </span>
            )}
            {item.storename && (
              <span style={{ color: "var(--sc-text-muted)" }}>
                <i className="bi bi-shop me-1"></i>
                {item.storename}
              </span>
            )}
          </div>

          <ItemNoteEditor item={item} listId={listId} />
        </div>

        {/* Action buttons */}
        <div className="d-flex gap-1" style={{ flexShrink: 0 }}>
          <button
            className={`sc-icon-btn ${isPaid ? "active" : ""}`}
            onClick={handleMarkPaid}
            disabled={busy}
            title={isPaid ? "בטל תשלום" : "סמן כשולם"}
            style={{
              background: isPaid ? "rgba(16, 185, 129, 0.1)" : "transparent",
              border: "none",
              borderRadius: "50%",
              width: "32px",
              height: "32px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            <i
              className="bi bi-currency-exchange"
              style={{
                color: isPaid ? "var(--sc-success)" : "var(--sc-text-muted)",
              }}
            ></i>
          </button>
          <button
            className="sc-icon-btn"
            onClick={() => setShowComments(!showComments)}
            title="הערות"
            style={{
              border: "none",
              background: "transparent",
              borderRadius: "50%",
              width: "32px",
              height: "32px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <i className="bi bi-chat-dots"></i>
          </button>
          <button
            className="sc-icon-btn"
            onClick={handleDelete}
            disabled={busy}
            title="מחק"
            style={{
              border: "none",
              background: "transparent",
              borderRadius: "50%",
              width: "32px",
              height: "32px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            <i
              className="bi bi-trash"
              style={{ color: "var(--sc-danger)" }}
            ></i>
          </button>
        </div>
      </div>

      {showComments && <ItemComments itemId={item.id} listId={listId} />}
    </div>
  );
};

export default ListItemRow;
