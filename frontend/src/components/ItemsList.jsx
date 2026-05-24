import React from "react";
import ListItemRow from "./ListItemRow";

export default function ItemsList({ items, listId }) {
  if (!items || items.length === 0) {
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
    <div>
      {items.map((item) => (
        <ListItemRow key={item.id} item={item} listId={listId} />
      ))}
    </div>
  );
}
