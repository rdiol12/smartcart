import React from "react";

export default function CompareModal({ show, onClose, data, loading }) {
  if (!show) return null;

  return (
    <div className="sc-modal-overlay" onClick={onClose} dir="rtl">
      <div className="sc-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "560px" }}>
        <div className="sc-modal-header">
          <h5>
            <i className="bi bi-bar-chart me-2"></i>השוואת מחירים
          </h5>
          <button className="sc-icon-btn" onClick={onClose}>
            <i className="bi bi-x-lg"></i>
          </button>
        </div>

        <div className="sc-modal-body" style={{ maxHeight: "70vh", overflowY: "auto" }}>
          {loading ? (
            <div className="text-center py-5">
              <div className="sc-spinner" style={{ margin: "0 auto" }}></div>
              <p className="mt-3" style={{ color: "var(--sc-text-muted)" }}>
                מחשב מחירים...
              </p>
            </div>
          ) : !data ? (
            <div className="text-center py-4" style={{ color: "var(--sc-text-muted)" }}>
              שגיאה בטעינת ההשוואה
            </div>
          ) : (
            <>
              {data.unlinkedCount > 0 && (
                <div
                  style={{
                    padding: "10px 14px",
                    borderRadius: "var(--sc-radius)",
                    marginBottom: "12px",
                    background: "rgba(245, 158, 11, 0.08)",
                    border: "1px solid rgba(245, 158, 11, 0.2)",
                    fontSize: "0.82rem",
                    color: "#b45309",
                  }}
                >
                  <i className="bi bi-info-circle me-1"></i>
                  {data.unlinkedCount} פריטים הוזנו ידנית ולא נכללים בהשוואה
                </div>
              )}

              {data.linkedCount === 0 ? (
                <div className="text-center py-4" style={{ color: "var(--sc-text-muted)" }}>
                  <i className="bi bi-link-45deg" style={{ fontSize: "2rem", opacity: 0.4 }}></i>
                  <p className="mt-2 mb-0">
                    אין פריטים מקושרים למוצרים בחנות. הוסף פריטים מדף החנות כדי להשוות מחירים.
                  </p>
                </div>
              ) : data.chains.length === 0 ? (
                <div className="text-center py-4" style={{ color: "var(--sc-text-muted)" }}>
                  <p className="mb-0">לא נמצאו מחירים עבור הפריטים ברשימה</p>
                </div>
              ) : (
                <div className="d-flex flex-column gap-3">
                  {data.chains.map((chain, idx) => (
                    <div
                      key={chain.chainId}
                      style={{
                        border: idx === 0 ? "2px solid var(--sc-success)" : "1px solid var(--sc-border)",
                        borderRadius: "var(--sc-radius)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          padding: "12px 16px",
                          background: idx === 0 ? "rgba(16, 185, 129, 0.06)" : "var(--sc-bg)",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <div className="d-flex align-items-center gap-2">
                          <i className="bi bi-shop" style={{ color: idx === 0 ? "var(--sc-success)" : "var(--sc-text-muted)" }}></i>
                          <span className="fw-bold" style={{ fontSize: "0.95rem" }}>{chain.chainName}</span>
                          {idx === 0 && (
                            <span className="sc-badge" style={{ background: "var(--sc-success)", color: "#fff", fontSize: "0.7rem", padding: "2px 8px" }}>הכי זול</span>
                          )}
                        </div>
                        <div className="d-flex align-items-center gap-2">
                          {!chain.complete && (
                            <span style={{ fontSize: "0.75rem", color: "#b45309" }}>
                              <i className="bi bi-exclamation-triangle me-1"></i>
                              חסרים {chain.missingCount}
                            </span>
                          )}
                          <span className="fw-bold" style={{ fontSize: "1.1rem", color: idx === 0 ? "var(--sc-success)" : "var(--sc-text)" }}>
                            ₪{chain.total.toFixed(2)}
                          </span>
                        </div>
                      </div>

                      <details style={{ borderTop: "1px solid var(--sc-border)" }}>
                        <summary style={{ padding: "8px 16px", cursor: "pointer", fontSize: "0.8rem", color: "var(--sc-text-muted)", userSelect: "none" }}>
                          פירוט פריטים ({chain.items.length})
                        </summary>
                        <div style={{ padding: "0 16px 12px" }}>
                          {chain.items.map((ci, i) => (
                            <div key={i} className="d-flex justify-content-between align-items-center" style={{ padding: "6px 0", borderBottom: i < chain.items.length - 1 ? "1px solid var(--sc-border)" : "none", fontSize: "0.82rem" }}>
                              <span style={{ color: ci.available ? "var(--sc-text)" : "#dc2626" }}>
                                {ci.itemName}
                                {ci.quantity > 1 && <span style={{ color: "var(--sc-text-muted)" }}> x{ci.quantity}</span>}
                              </span>
                              {ci.available ? (
                                <span style={{ color: "var(--sc-text-muted)" }}>
                                  ₪{ci.price.toFixed(2)}{ci.quantity > 1 && ` = ₪${ci.subtotal.toFixed(2)}`}
                                </span>
                              ) : (
                                <span style={{ color: "#dc2626", fontWeight: 600 }}>לא זמין</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </details>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="sc-modal-footer">
          <button className="sc-btn sc-btn-ghost" onClick={onClose}>סגור</button>
        </div>
      </div>
    </div>
  );
}
