import React from "react";
import { useNavigate } from "react-router-dom";

export default function ListHeader({
  list,
  members,
  userRole,
  isLinkedChild,
  onOpenInvite,
  onOpenChildren,
  onDeleteList,
  onLeaveList,
  onOpenSaveTemplate,
}) {
  const navigate = useNavigate();

  return (
    <div className="d-flex justify-content-between align-items-start mb-3">
      <div>
        <button
          className="sc-btn sc-btn-ghost mb-2"
          onClick={() => navigate("/list")}
          style={{ fontSize: "0.8rem", padding: "4px 12px" }}
        >
          <i className="bi bi-arrow-right me-1"></i> חזרה
        </button>
        <h3 className="fw-bold mb-1">{list?.list_name}</h3>
        <div
          className="d-flex align-items-center gap-3"
          style={{ color: "var(--sc-text-muted)", fontSize: "0.85rem" }}
        >
          <span>
            <i className="bi bi-people me-1"></i>
            {members.map((m) => m.first_name).join(", ")}
          </span>
        </div>
      </div>
      {!isLinkedChild && (
        <div className="d-flex gap-2">
          {userRole === "admin" && (
            <>
              <button
                className="sc-btn sc-btn-ghost"
                onClick={onOpenInvite}
                style={{ fontSize: "0.8rem", padding: "6px 12px" }}
              >
                <i className="bi bi-person-plus me-1"></i> הזמן
              </button>
              <button
                className="sc-btn sc-btn-ghost"
                onClick={onOpenChildren}
                style={{ fontSize: "0.8rem", padding: "6px 12px" }}
              >
                <i className="bi bi-people me-1"></i> ילדים
              </button>
              <button
                className="sc-btn sc-btn-ghost"
                onClick={onOpenSaveTemplate}
                style={{ fontSize: "0.8rem", padding: "6px 12px" }}
              >
                <i className="bi bi-bookmark me-1"></i> תבנית
              </button>
              <button
                className="sc-btn sc-btn-ghost"
                onClick={onDeleteList}
                style={{
                  fontSize: "0.8rem",
                  padding: "6px 12px",
                  color: "var(--sc-danger)",
                }}
              >
                <i className="bi bi-trash me-1"></i> מחק
              </button>
            </>
          )}
          {userRole === "member" && (
            <>
              <button
                className="sc-btn sc-btn-ghost"
                onClick={onOpenSaveTemplate}
                style={{ fontSize: "0.8rem", padding: "6px 12px" }}
              >
                <i className="bi bi-bookmark me-1"></i> תבנית
              </button>
              <button
                className="sc-btn sc-btn-ghost"
                onClick={onLeaveList}
                style={{
                  fontSize: "0.8rem",
                  padding: "6px 12px",
                  color: "var(--sc-danger)",
                }}
              >
                <i className="bi bi-box-arrow-left me-1"></i> עזוב
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
