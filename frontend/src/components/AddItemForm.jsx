import React from "react";
import ProductSearchForList from "./ProductSearchForList";

export default function AddItemForm({
  selectedProduct,
  itemQty,
  setItemQty,
  setSelectedProduct,
  isLinkedChild,
  onSubmit,
  onOpenScanner,
  requestMsg,
  clearSelectedProduct,
}) {
  return (
    <div className="sc-card p-3 mb-3">
      {selectedProduct ? (
        <form onSubmit={onSubmit}>
          <div className="d-flex align-items-center gap-3">
            <div
              style={{
                width: "38px",
                height: "38px",
                borderRadius: "10px",
                flexShrink: 0,
                background:
                  "linear-gradient(135deg, rgba(79,70,229,0.1), rgba(6,182,212,0.08))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <i
                className="bi bi-box-seam"
                style={{ color: "var(--sc-primary)", fontSize: "0.9rem" }}
              ></i>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="fw-bold" style={{ fontSize: "0.9rem" }}>
                {selectedProduct.item_name}
              </div>
              <small style={{ color: "var(--sc-text-muted)" }}>
                {selectedProduct.price ? `₪${selectedProduct.price}` : ""}
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
                type="button"
                className="sc-icon-btn"
                onClick={() => setItemQty(Math.max(1, itemQty - 1))}
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
                {itemQty}
              </span>
              <button
                type="button"
                className="sc-icon-btn"
                onClick={() => setItemQty(itemQty + 1)}
                style={{ width: "26px", height: "26px" }}
              >
                <i className="bi bi-plus" style={{ fontSize: "0.8rem" }}></i>
              </button>
            </div>
            <button
              type="submit"
              className={`sc-btn ${isLinkedChild ? "sc-btn-ghost" : "sc-btn-primary"}`}
              style={{ padding: "8px 16px", whiteSpace: "nowrap" }}
            >
              {isLinkedChild ? (
                <>
                  <i className="bi bi-send me-1"></i> בקש
                </>
              ) : (
                <i className="bi bi-plus-lg"></i>
              )}
            </button>
            <button
              type="button"
              className="sc-icon-btn"
              onClick={clearSelectedProduct}
              title="בטל"
            >
              <i className="bi bi-x-lg"></i>
            </button>
          </div>
        </form>
      ) : (
        <div className="d-flex gap-2 align-items-start">
          <div style={{ flexGrow: 1, minWidth: 0 }}>
            <ProductSearchForList onSelect={setSelectedProduct} />
          </div>
          <button
            type="button"
            className="sc-icon-btn"
            onClick={onOpenScanner}
            title="סרוק ברקוד"
          >
            <i className="bi bi-upc-scan"></i>
          </button>
        </div>
      )}
      {requestMsg && (
        <div
          className="mt-2"
          style={{
            fontSize: "0.85rem",
            color: "var(--sc-primary)",
            fontWeight: 500,
          }}
        >
          <i className="bi bi-info-circle me-1"></i>
          {requestMsg}
        </div>
      )}
    </div>
  );
}
