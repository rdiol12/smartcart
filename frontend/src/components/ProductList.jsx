import React from "react";
import { useNavigate } from "react-router-dom";

export default function ProductList({
  products,
  user,
  isLinkedChild,
  handleAddToList,
  hasMore,
  loadMore,
  loading,
  searchQuery,
}) {
  const navigate = useNavigate();

  return (
    <>
      <div>
        <div
          className="d-flex align-items-center gap-2 mb-3"
          style={{ color: "var(--sc-text-muted)", fontSize: "0.85rem" }}
        >
          <i className="bi bi-list-ul"></i>
          <span>
            תוצאות עבור "
            <strong style={{ color: "var(--sc-text)" }}>{searchQuery}</strong>"
          </span>
        </div>

        <div className="d-flex flex-column gap-3">
          {products.map((product, index) => (
            <div
              key={`${product.item_id}-${product.chain_id}-${index}`}
              className="sc-product-row"
            >
              <div
                className="d-flex align-items-center gap-3 flex-grow-1"
                style={{ cursor: "pointer", minWidth: 0 }}
                onClick={() =>
                  navigate(`/product/${product.item_id}`, {
                    state: { product },
                  })
                }
              >
                {product.image_url ? (
                  <img
                    src={product.image_url}
                    alt={product.item_name}
                    className="sc-product-icon"
                    style={{ objectFit: "contain", background: "#fff" }}
                  />
                ) : (
                  <div className="sc-product-icon">
                    <i className="bi bi-box-seam"></i>
                  </div>
                )}
                <div className="sc-product-info">
                  <p className="sc-product-name">{product.item_name}</p>
                  {product.chain_name && (
                    <div className="sc-product-chain">
                      <i className="bi bi-shop me-1"></i>
                      {product.chain_name}
                    </div>
                  )}
                </div>
                <div className="sc-product-price">₪{product.price}</div>
              </div>
              {user && (
                <button
                  className={`sc-product-add-btn ${isLinkedChild ? "child" : ""}`}
                  onClick={() => handleAddToList(product)}
                >
                  <i
                    className={`bi ${isLinkedChild ? "bi-send" : "bi-plus-circle"}`}
                  ></i>
                  {isLinkedChild ? "בקש" : "הוסף"}
                </button>
              )}
            </div>
          ))}
        </div>

        {hasMore && (
          <div className="text-center mt-4">
            <button
              className="sc-btn sc-btn-ghost"
              onClick={loadMore}
              disabled={loading}
              style={{ padding: "10px 28px" }}
            >
              {loading ? (
                <span className="spinner-border spinner-border-sm"></span>
              ) : (
                <>
                  <i className="bi bi-arrow-down-circle me-2"></i>הצג עוד תוצאות
                </>
              )}
            </button>
          </div>
        )}

        {!hasMore && products.length > 0 && (
          <p
            className="text-center mt-3 mb-0"
            style={{ color: "var(--sc-text-muted)", fontSize: "0.85rem" }}
          >
            סוף התוצאות
          </p>
        )}
      </div>
    </>
  );
}
