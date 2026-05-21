import React, { useState } from "react";
import socket from "../socket";
import { useNotify } from "../context/NotifyContext";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";

// Mirror the server's createListSchema bounds (utils/socketSchemas.js).
// Without these the socket emit fires, the validator on the other side
// returns { success: false }, and the user sees the generic "create
// failed" toast with no way to know the length is the problem.
const LIST_NAME_MAX = 200;

const CreateListModal = ({ show, onClose, onCreated }) => {
  useBodyScrollLock(show);
  const notify = useNotify();
  const [listName, setListName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreate = () => {
    const trimmed = listName.trim();
    if (!trimmed) return;
    if (trimmed.length > LIST_NAME_MAX) {
      notify(`שם הרשימה ארוך מדי (מקסימום ${LIST_NAME_MAX} תווים)`);
      return;
    }
    setLoading(true);
    // No userId — backend reads it from socket.user.id (JWT).
    socket.emit("create_list", { list_name: trimmed }, (response) => {
      setLoading(false);
      if (response.success) {
        setListName("");
        onCreated(response.listId);
        onClose();
      } else {
        notify(response.error || "שגיאה ביצירת הרשימה");
      }
    });
  };

  if (!show) return null;

  return (
    <div className="sc-modal-overlay" dir="rtl">
      <div className="sc-modal">
        <div className="sc-modal-header">
          <h5>יצירת רשימה חדשה</h5>
          <button className="sc-icon-btn" onClick={onClose}>
            <i className="bi bi-x-lg"></i>
          </button>
        </div>
        <div className="sc-modal-body">
          <label className="form-label fw-semibold" style={{ fontSize: "0.9rem" }}>שם הרשימה</label>
          <input
            type="text"
            className="form-control sc-input"
            placeholder="למשל: קניות לשבת"
            value={listName}
            onChange={(e) => setListName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            maxLength={LIST_NAME_MAX}
            autoFocus
          />
        </div>
        <div className="sc-modal-footer">
          <button className="sc-btn sc-btn-ghost" onClick={onClose}>ביטול</button>
          <button className="sc-btn sc-btn-primary" onClick={handleCreate} disabled={loading || !listName.trim()}>
            {loading ? "יוצר..." : "צור רשימה"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateListModal;
