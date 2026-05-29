import React from "react";
import ListItemRow from "./ListItemRow";

export default function ItemsList({ items, listId }) {
  // Add safety check
  if (!items || !Array.isArray(items) || items.length === 0) {
    return (
      <div className="sc-card">
        <div className="sc-empty" style={{ padding: "2rem" }}>
          <div className="sc-empty-icon">
            <i className="bi bi-basket"></i>
          </div>
          <h4>הרשימה ריקה</h4>
          <p>הוסף פריטים למעלה כדי להתחיל</p>
        </div>
      </div>
    );
  }

  return (
    <div className="d-flex flex-column gap-2">
      {items
        .filter((item) => item && typeof item === "object")
        .map((item) => (
          <ListItemRow key={item.id} item={item} listId={listId} />
        ))}
    </div>
  );
}
