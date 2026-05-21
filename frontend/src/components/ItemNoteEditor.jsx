import React, { useState, useRef } from "react";
import socket from "../socket";

const ItemNoteEditor = ({ item, listId }) => {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(item.note || "");
  // Track the last value we actually emitted so onBlur (which fires
  // immediately after Enter calls setEditing(false) and unmounts the input)
  // doesn't double-emit the same update.
  const lastEmittedRef = useRef(item.note || "");

  const handleSave = () => {
    const trimmed = note;
    if (trimmed === lastEmittedRef.current) {
      setEditing(false);
      return;
    }
    lastEmittedRef.current = trimmed;
    // No userId — backend reads it from socket.user.id (JWT).
    socket.emit("update_note", { itemId: item.id, listId, note: trimmed });
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="mt-1">
        <input
          type="text"
          className="form-control form-control-sm"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          placeholder="הוסף הערה..."
          autoFocus
        />
      </div>
    );
  }

  return (
    <small
      className="text-muted d-block fst-italic"
      style={{ cursor: "pointer" }}
      onClick={() => setEditing(true)}
    >
      {item.note ? (
        <>
          {item.note}
          {item.note_by_name && (
            <span style={{ fontSize: "0.75rem", opacity: 0.7 }}> — {item.note_by_name}</span>
          )}
        </>
      ) : (
        "לחץ להוספת הערה..."
      )}
    </small>
  );
};

export default ItemNoteEditor;
