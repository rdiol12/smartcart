import React from "react";

export default function ChildrenModal({
  show,
  onClose,
  childrenList,
  loading,
  onToggleChild,
}) {
  if (!show) return null;

  return (
    <div className="sc-modal-overlay" onClick={onClose} dir="rtl">
      <div
        className="sc-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "440px" }}
      >
        <div className="sc-modal-header">
          <h5>
            <i className="bi bi-people me-2"></i>ניהול גישת ילדים
          </h5>
          <button className="sc-icon-btn" onClick={onClose}>
            <i className="bi bi-x-lg"></i>
          </button>
        </div>

        <div className="sc-modal-body">
          {loading ? (
            <div className="text-center py-4">
              <div className="sc-spinner" style={{ margin: "0 auto" }}></div>
            </div>
          ) : childrenList.length === 0 ? (
            <div
              className="text-center py-4"
              style={{ color: "var(--sc-text-muted)" }}
            >
              <i
                className="bi bi-person-x"
                style={{ fontSize: "2rem", opacity: 0.4 }}
              ></i>
              <p className="mt-2 mb-0">אין חשבונות ילדים מקושרים</p>
              <small>צור חשבון ילד בהגדרות הפרופיל</small>
            </div>
          ) : (
            <div className="d-flex flex-column gap-2">
              {childrenList.map((child) => (
                <div
                  key={child.id}
                  className="d-flex justify-content-between align-items-center"
                  style={{
                    padding: "12px 16px",
                    borderRadius: "var(--sc-radius)",
                    background: child.is_member
                      ? "rgba(16, 185, 129, 0.06)"
                      : "var(--sc-bg)",
                    border: child.is_member
                      ? "1px solid rgba(16, 185, 129, 0.2)"
                      : "1px solid var(--sc-border)",
                  }}
                >
                  <div className="d-flex align-items-center gap-2">
                    <div
                      style={{
                        width: "34px",
                        height: "34px",
                        borderRadius: "50%",
                        background:
                          "linear-gradient(135deg, rgba(79,70,229,0.1), rgba(6,182,212,0.08))",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <i
                        className="bi bi-person"
                        style={{
                          color: "var(--sc-primary)",
                          fontSize: "0.9rem",
                        }}
                      ></i>
                    </div>
                    <div>
                      <div className="fw-bold" style={{ fontSize: "0.9rem" }}>
                        {child.first_name}
                      </div>
                      {child.username && (
                        <small style={{ color: "var(--sc-text-muted)" }}>
                          @{child.username}
                        </small>
                      )}
                    </div>
                  </div>
                  <div
                    onClick={() => onToggleChild(child.id, child.is_member)}
                    style={{
                      width: "44px",
                      height: "24px",
                      borderRadius: "12px",
                      cursor: "pointer",
                      background: child.is_member
                        ? "var(--sc-success)"
                        : "var(--sc-border)",
                      position: "relative",
                      transition: "background 0.2s ease",
                    }}
                  >
                    <div
                      style={{
                        width: "20px",
                        height: "20px",
                        borderRadius: "50%",
                        background: "#fff",
                        position: "absolute",
                        top: "2px",
                        right: child.is_member ? "2px" : "22px",
                        transition: "right 0.2s ease",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="sc-modal-footer">
          <button className="sc-btn sc-btn-ghost" onClick={onClose}>
            סגור
          </button>
        </div>
      </div>
    </div>
  );
}
