import React from "react";

export default function AddToListModal({
  selectedProduct,
  onClose,
  quantity,
  setQuantity,
  lists,
  selectedListId,
  setSelectedListId,
  confirmAddToList,
  addingToList,
  isLinkedChild,
  successMsg,
}) {
  if (!selectedProduct) return null;

  return (
    <div className="sc-modal-overlay" onClick={onClose} dir="rtl">
      <div
        className="sc-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "440px" }}
      >
        <div className="sc-modal-header">
          <h5>{isLinkedChild ? "בחר רשימה לבקשה" : "הוסף לרשימה"}</h5>
          <button className="sc-icon-btn" onClick={onClose}>
            <i className="bi bi-x-lg"></i>
          </button>
        </div>

        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid var(--sc-border)",
            background: "rgba(79,70,229,0.03)",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <div
            style={{
              width: "42px",
              height: "42px",
              borderRadius: "12px",
              flexShrink: 0,
              background:
                "linear-gradient(135deg, rgba(79,70,229,0.1), rgba(6,182,212,0.08))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {selectedProduct.image_url ? (
              <img
                src={selectedProduct.image_url}
                alt=""
                style={{ width: "28px", height: "28px", objectFit: "contain" }}
              />
            ) : (
              <i
                className="bi bi-box-seam"
                style={{ color: "var(--sc-primary)", fontSize: "1.1rem" }}
              ></i>
            )}
          </div>
          <div style={{ flex: 1 }}>
            <div className="fw-bold" style={{ fontSize: "0.9rem" }}>
              {selectedProduct.item_name}
            </div>
            <small style={{ color: "var(--sc-text-muted)" }}>
              ₪{selectedProduct.price ?? "—"}
              {selectedProduct.chain_name
                ? ` · ${selectedProduct.chain_name}`
                : ""}
            </small>
          </div>
          <div
            className="d-flex align-items-center gap-2"
            style={{
              background: "var(--sc-bg)",
              borderRadius: "10px",
              padding: "4px 8px",
            }}
          >
            <button
              className="sc-icon-btn"
              onClick={() => setQuantity(Math.max(1, quantity - 1))}
              style={{ width: "26px", height: "26px" }}
            >
              <i className="bi bi-dash" style={{ fontSize: "0.8rem" }}></i>
            </button>
            <span
              className="fw-bold"
              style={{
                fontSize: "0.9rem",
                minWidth: "18px",
                textAlign: "center",
              }}
            >
              {quantity}
            </span>
            <button
              className="sc-icon-btn"
              onClick={() => setQuantity(quantity + 1)}
              style={{ width: "26px", height: "26px" }}
            >
              <i className="bi bi-plus" style={{ fontSize: "0.8rem" }}></i>
            </button>
          </div>
        </div>

        <div
          className="sc-modal-body"
          style={{ maxHeight: "280px", overflowY: "auto" }}
        >
          {lists.length === 0 ? (
            <div
              className="text-center py-4"
              style={{ color: "var(--sc-text-muted)" }}
            >
              <i
                className="bi bi-list-check"
                style={{ fontSize: "2rem", opacity: 0.4 }}
              ></i>
              <p className="mt-2 mb-0">אין רשימות. צור רשימה חדשה תחילה.</p>
            </div>
          ) : (
            <div className="d-flex flex-column gap-2">
              {lists.map((list) => (
                <div
                  key={list.id}
                  style={{
                    padding: "12px 16px",
                    borderRadius: "var(--sc-radius)",
                    cursor: "pointer",
                    background:
                      selectedListId === list.id
                        ? "rgba(79,70,229,0.06)"
                        : "var(--sc-bg)",
                    border:
                      selectedListId === list.id
                        ? "2px solid var(--sc-primary)"
                        : "2px solid transparent",
                    transition: "all 0.15s ease",
                  }}
                  onClick={() => setSelectedListId(list.id)}
                >
                  <div className="d-flex justify-content-between align-items-center">
                    <div>
                      <h6
                        className="mb-0 fw-bold"
                        style={{ fontSize: "0.95rem" }}
                      >
                        {list.list_name}
                      </h6>
                      <small style={{ color: "var(--sc-text-muted)" }}>
                        {list.item_count} פריטים · {list.member_count} חברים
                      </small>
                    </div>
                    {selectedListId === list.id && (
                      <i
                        className="bi bi-check-circle-fill"
                        style={{
                          color: "var(--sc-primary)",
                          fontSize: "1.2rem",
                        }}
                      ></i>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="sc-modal-footer">
          <button className="sc-btn sc-btn-ghost" onClick={onClose}>
            ביטול
          </button>
          <button
            className={`sc-btn ${isLinkedChild ? "sc-btn-ghost" : "sc-btn-primary"}`}
            onClick={confirmAddToList}
            disabled={!selectedListId || addingToList}
            style={{ minWidth: "120px" }}
          >
            {addingToList ? (
              <span className="spinner-border spinner-border-sm"></span>
            ) : isLinkedChild ? (
              <>
                <i className="bi bi-send me-1"></i> שלח בקשה
              </>
            ) : (
              <>
                <i className="bi bi-plus-lg me-1"></i> הוסף
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
