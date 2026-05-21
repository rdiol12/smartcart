import React, { useState, useEffect } from "react";
import api from "../api";
import { useNotify } from "../context/NotifyContext";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";

const ApplyTemplateModal = ({ show, onClose, onApplied }) => {
  useBodyScrollLock(show);
  const notify = useNotify();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  // Two-step UX: after a template is picked we show a name field instead of
  // immediately POSTing with the template's name. Previously the modal used
  // template.template_name verbatim, so applying the same template twice
  // produced two lists with identical names — confusing on MyLists.
  const [selected, setSelected] = useState(null);
  const [listName, setListName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!show) return;
    // Reset state when the modal is reopened.
    setSelected(null);
    setListName("");
    setSubmitting(false);
    const fetchTemplates = async () => {
      try {
        const { data } = await api.get("/api/templates");
        setTemplates(data.templates);
      } catch (err) {
        notify(err.response?.data?.message || "שגיאה בטעינת תבניות");
      } finally {
        setLoading(false);
      }
    };
    fetchTemplates();
  }, [show, notify]);

  const handleChooseTemplate = (template) => {
    setSelected(template);
    setListName(template.template_name);
  };

  const handleSubmit = async () => {
    if (!selected) return;
    const trimmed = listName.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const { data } = await api.post(
        `/api/templates/${selected.id}/apply`,
        { listName: trimmed },
      );
      onApplied(data.listId);
      onClose();
    } catch (err) {
      notify(err.response?.data?.message || "שגיאה בהחלת התבנית");
    } finally {
      setSubmitting(false);
    }
  };

  if (!show) return null;

  return (
    <div className="sc-modal-overlay" dir="rtl">
      <div className="sc-modal">
        <div className="sc-modal-header">
          <h5>{selected ? "שם הרשימה החדשה" : "יצירת רשימה מתבנית"}</h5>
          <button className="sc-icon-btn" onClick={onClose}>
            <i className="bi bi-x-lg"></i>
          </button>
        </div>
        <div className="sc-modal-body">
          {loading ? (
            <div className="text-center py-3">
              <div className="sc-spinner" style={{ margin: "0 auto" }}></div>
            </div>
          ) : selected ? (
            <div>
              <p style={{ color: "var(--sc-text-muted)", fontSize: "0.85rem" }}>
                יוצר רשימה מתוך התבנית{" "}
                <strong>{selected.template_name}</strong>. בחר שם שונה אם
                כבר יש לך רשימה בשם הזה.
              </p>
              <input
                type="text"
                className="form-control sc-input"
                value={listName}
                onChange={(e) => setListName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                autoFocus
              />
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-3">
              <p style={{ color: "var(--sc-text-muted)" }}>
                אין תבניות שמורות
              </p>
            </div>
          ) : (
            <div className="d-flex flex-column gap-2">
              {templates.map((t) => (
                <button
                  key={t.id}
                  className="sc-card sc-card-interactive p-3 d-flex justify-content-between align-items-center border-0"
                  style={{ background: "var(--sc-bg)", textAlign: "start" }}
                  onClick={() => handleChooseTemplate(t)}
                >
                  <span className="fw-semibold">{t.template_name}</span>
                  <span className="sc-badge sc-badge-muted">
                    {t.item_count} פריטים
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="sc-modal-footer">
          {selected ? (
            <>
              <button
                className="sc-btn sc-btn-ghost"
                onClick={() => setSelected(null)}
                disabled={submitting}
              >
                חזרה
              </button>
              <button
                className="sc-btn sc-btn-primary"
                onClick={handleSubmit}
                disabled={submitting || !listName.trim()}
              >
                {submitting ? "יוצר..." : "צור רשימה"}
              </button>
            </>
          ) : (
            <button className="sc-btn sc-btn-ghost" onClick={onClose}>
              ביטול
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ApplyTemplateModal;
