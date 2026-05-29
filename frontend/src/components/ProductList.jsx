import React from "react";
import { useNavigate } from "react-router-dom";

const ProductImage = React.memo(({ imageUrl, itemName, barcode, itemId }) => {
  const [src, setSrc] = React.useState(imageUrl);
  const [isLoading, setIsLoading] = React.useState(!imageUrl); // Fixed: start loading if no imageUrl

  React.useEffect(() => {
    const abortController = new AbortController();

    // If we already have an imageUrl, no need to fetch
    if (imageUrl) {
      setSrc(imageUrl);
      setIsLoading(false);
      return;
    }

    // If no barcode or itemId, can't fetch
    if (!barcode || !itemId) {
      setIsLoading(false);
      return;
    }

    // Fetch image
    setIsLoading(true);
    fetch(`/api/items/${itemId}/image`, { signal: abortController.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (data.image_url) {
          setSrc(data.image_url);
        } else {
          setSrc(null);
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          console.error(`Error fetching image for item ${itemId}:`, err);
        }
        setSrc(null);
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => abortController.abort();
  }, [imageUrl, barcode, itemId]); // Fixed: added imageUrl to dependencies

  // Show loading spinner
  if (isLoading) {
    return (
      <div className="sc-product-icon sc-image-loading">
        <div className="spinner-border spinner-border-sm text-muted"></div>
      </div>
    );
  }

  // Show image if available
  if (src) {
    return (
      <img
        src={src}
        alt={itemName || "Product image"}
        className="sc-product-icon"
        style={{ objectFit: "contain", background: "#fff" }}
        onError={() => {
          console.error(`Image failed to load for item ${itemId}:`, src);
          setSrc(null);
        }}
        loading="lazy"
      />
    );
  }

  // Fallback: colored placeholder with first letter
  const getColorFromName = (name) => {
    if (!name) return "#e2e8f0";
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 70%, 85%)`;
  };

  const firstLetter = itemName?.charAt(0) || "?";
  const bgColor = getColorFromName(itemName);

  return (
    <div
      className="sc-product-icon"
      style={{
        background: bgColor,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "24px",
        fontWeight: "bold",
        color: "#333",
      }}
    >
      {firstLetter}
    </div>
  );
});

ProductImage.displayName = "ProductImage";

const ProductRow = React.memo(
  ({ product, user, isLinkedChild, handleAddToList, navigate }) => {
    const formattedPrice =
      typeof product.price === "number"
        ? product.price.toFixed(2)
        : product.price;

    return (
      <div className="sc-product-row">
        <div
          className="d-flex align-items-center gap-3 flex-grow-1"
          style={{ cursor: "pointer", minWidth: 0 }}
          onClick={() =>
            navigate(`/product/${product.item_id}`, {
              state: { product },
            })
          }
        >
          <ProductImage
            imageUrl={product.image_url}
            itemName={product.item_name}
            barcode={product.barcode}
            itemId={product.item_id}
          />
          <div className="sc-product-info">
            <p className="sc-product-name">{product.item_name}</p>
            {product.chain_name && (
              <div className="sc-product-chain">
                <i className="bi bi-shop me-1"></i>
                {product.chain_name}
              </div>
            )}
          </div>
          <div className="sc-product-price">₪{formattedPrice}</div>
        </div>
        {user && (
          <button
            className={`sc-product-add-btn ${isLinkedChild ? "child" : ""}`}
            onClick={() => handleAddToList(product)}
            aria-label={isLinkedChild ? "Request item" : "Add to list"}
          >
            <i
              className={`bi ${isLinkedChild ? "bi-send" : "bi-plus-circle"}`}
            ></i>
            {isLinkedChild ? "בקש" : "הוסף"}
          </button>
        )}
      </div>
    );
  },
);

ProductRow.displayName = "ProductRow";

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

  if (!products || products.length === 0) {
    return (
      <div className="text-center py-5">
        <i
          className="bi bi-search"
          style={{ fontSize: "3rem", color: "var(--sc-text-muted)" }}
        ></i>
        <p className="mt-3" style={{ color: "var(--sc-text-muted)" }}>
          {searchQuery ? "לא נמצאו תוצאות עבור החיפוש שלך" : "אין מוצרים להצגה"}
        </p>
      </div>
    );
  }

  return (
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
          <ProductRow
            key={`${product.item_id}-${product.chain_id || index}`}
            product={product}
            user={user}
            isLinkedChild={isLinkedChild}
            handleAddToList={handleAddToList}
            navigate={navigate}
          />
        ))}
      </div>

      {hasMore && (
        <div className="text-center mt-4">
          <button
            className="sc-btn sc-btn-ghost"
            onClick={loadMore}
            disabled={loading}
            style={{ padding: "10px 28px" }}
            aria-label="Load more products"
          >
            {loading ? (
              <span className="spinner-border spinner-border-sm" role="status">
                <span className="visually-hidden">Loading...</span>
              </span>
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
  );
}
