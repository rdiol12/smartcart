import React, { useState, useEffect, useContext } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import api from "../api";
import PriceHistoryChart from "../components/PriceHistoryChart";
import { useNotify } from "../context/NotifyContext";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";

// Helper function to get color based on string
const getColorFromString = (str) => {
  if (!str) return "#e2e8f0";
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 70%, 85%)`;
};

const ProductPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isLinkedChild } = useContext(AuthContext);
  const notify = useNotify();

  const [product, setProduct] = useState(location.state?.product || null);
  const [loading, setLoading] = useState(!location.state?.product);
  const [quantity, setQuantity] = useState(1);
  const [imageError, setImageError] = useState(false);
  const [refreshingImage, setRefreshingImage] = useState(false);

  // List selection modal
  const [showListModal, setShowListModal] = useState(false);
  const [lists, setLists] = useState([]);
  const [selectedListId, setSelectedListId] = useState(null);
  const [addingToList, setAddingToList] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  useBodyScrollLock(showListModal);

  useEffect(() => {
    if (!product) {
      const fetchProduct = async () => {
        try {
          const { data } = await api.get(`/api/products/${id}`);
          setProduct(data.product);
          setImageError(false);
        } catch (err) {
          notify(err.response?.data?.message || "שגיאה בטעינת המוצר");
        } finally {
          setLoading(false);
        }
      };
      fetchProduct();
    }
  }, [id, product, notify]);

  const refreshImage = async () => {
    if (!product?.item_id) return;

    setRefreshingImage(true);
    try {
      // Fetch fresh product data
      const { data } = await api.get(`/api/products/${id}?t=${Date.now()}`);
      setProduct(data.product);
      setImageError(false);
      notify("תמונת המוצר רועננה", "success");
    } catch (err) {
      console.error("Failed to refresh image:", err);
      notify("לא ניתן לרענן את התמונה כרגע", "error");
    } finally {
      setRefreshingImage(false);
    }
  };

  const handleAddToList = async () => {
    if (!user) {
      navigate("/login");
      return;
    }
    try {
      const { data } = await api.get("/api/lists");
      setLists(data.lists);
      setShowListModal(true);
    } catch (err) {
      notify(err.response?.data?.message || "שגיאה בטעינת הרשימות");
    }
  };

  const confirmAddToList = async () => {
    if (!selectedListId) return;
    setAddingToList(true);
    try {
      const selectedList = lists.find((l) => l.id === selectedListId);
      if (isLinkedChild) {
        await api.post("/api/family/kid-requests", {
          listId: selectedListId,
          itemName: product.item_name,
          price: product.price || null,
          storeName: product.chain_name || null,
          quantity,
          productId: product.item_id || null,
        });
        setSuccessMsg("הבקשה נשלחה לאישור ההורה!");
      } else {
        await api.post(`/api/lists/${selectedListId}/items`, {
          itemName: product.item_name,
          price: product.price || null,
          storeName: product.chain_name || null,
          quantity,
          productId: product.item_id || null,
        });
        setSuccessMsg(`המוצר נוסף לרשימה "${selectedList?.list_name}"!`);
      }
      setShowListModal(false);
      setSelectedListId(null);
      setTimeout(() => setSuccessMsg(""), 4000);
    } catch (err) {
      notify(err.response?.data?.message || "שגיאה בהוספת המוצר");
    } finally {
      setAddingToList(false);
    }
  };

  if (loading) {
    return (
      <div className="sc-loading-page">
        <div className="sc-spinner"></div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="page-fade-in" dir="rtl">
        <div className="container py-4 text-center">
          <div className="sc-empty">
            <div className="sc-empty-icon">
              <i className="bi bi-box-seam"></i>
            </div>
            <h4>המוצר לא נמצא</h4>
            <button
              className="sc-btn sc-btn-ghost mt-3"
              onClick={() => navigate("/store")}
            >
              <i className="bi bi-arrow-right me-1"></i> חזרה לחנות
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Determine what image to display
  const displayImage =
    !imageError && product.image_url ? product.image_url : null;
  const bgColor = getColorFromString(product.item_name);
  const firstLetter = product.item_name?.charAt(0) || "?";

  return (
    <div className="page-fade-in" dir="rtl">
      <div className="container py-4">
        <button
          className="sc-btn sc-btn-ghost mb-4"
          onClick={() => navigate(-1)}
          style={{ fontSize: "0.85rem" }}
        >
          <i className="bi bi-arrow-right me-1"></i> חזרה
        </button>

        {/* Success message */}
        {successMsg && (
          <div
            className="alert d-flex align-items-center mb-3"
            style={{
              background: "rgba(16, 185, 129, 0.08)",
              border: "1px solid rgba(16, 185, 129, 0.2)",
              borderRadius: "var(--sc-radius)",
              color: "var(--sc-success)",
              fontSize: "0.9rem",
            }}
          >
            <i className="bi bi-check-circle-fill me-2"></i>
            <span>{successMsg}</span>
          </div>
        )}

        <div className="row g-4">
          {/* Product image */}
          <div className="col-md-5">
            <div style={{ position: "relative" }}>
              <div
                className="sc-card d-flex align-items-center justify-content-center"
                style={{
                  height: "360px",
                  background:
                    "linear-gradient(135deg, rgba(99,102,241,0.04), rgba(236,72,153,0.04))",
                }}
              >
                {displayImage ? (
                  <img
                    src={displayImage}
                    alt={product.item_name}
                    style={{
                      maxHeight: "100%",
                      maxWidth: "100%",
                      objectFit: "contain",
                    }}
                    onError={() => setImageError(true)}
                    loading="lazy"
                  />
                ) : (
                  <div
                    className="text-center d-flex flex-column align-items-center justify-content-center"
                    style={{
                      width: "100%",
                      height: "100%",
                      background: bgColor,
                      borderRadius: "var(--sc-radius)",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "4rem",
                        fontWeight: "bold",
                        color: "#333",
                      }}
                    >
                      {firstLetter}
                    </span>
                    <span
                      style={{
                        fontSize: "0.85rem",
                        color: "#666",
                        marginTop: "8px",
                      }}
                    >
                      {product.item_name}
                    </span>
                  </div>
                )}
              </div>

              {/* Refresh image button - only show when no image or image error */}
              {(!product.image_url || imageError) && product.barcode && (
                <button
                  onClick={refreshImage}
                  disabled={refreshingImage}
                  style={{
                    position: "absolute",
                    bottom: "12px",
                    left: "12px",
                    background: "var(--sc-surface)",
                    border: "1px solid var(--sc-border)",
                    borderRadius: "50%",
                    width: "36px",
                    height: "36px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    boxShadow: "var(--sc-shadow-sm)",
                  }}
                  aria-label="רענן תמונה"
                >
                  {refreshingImage ? (
                    <div
                      className="spinner-border spinner-border-sm"
                      style={{ width: "16px", height: "16px" }}
                    />
                  ) : (
                    <i
                      className="bi bi-arrow-repeat"
                      style={{ fontSize: "1.1rem" }}
                    ></i>
                  )}
                </button>
              )}
            </div>

            {/* Info message when no image */}
            {product.barcode && !product.image_url && !imageError && (
              <div
                className="mt-2 text-center"
                style={{
                  fontSize: "0.75rem",
                  color: "var(--sc-text-muted)",
                }}
              >
                <i className="bi bi-info-circle me-1"></i>
                אין תמונה זמינה כרגע. לחץ על כפתור הרענון לבדיקה חוזרת.
              </div>
            )}
          </div>

          {/* Product info */}
          <div className="col-md-7">
            <div className="sc-card p-4">
              {product.category && (
                <span
                  className="sc-badge sc-badge-muted mb-2"
                  style={{ display: "inline-block" }}
                >
                  {product.category}
                </span>
              )}
              <span
                className="sc-badge sc-badge-primary mb-2 ms-2"
                style={{ display: "inline-block" }}
              >
                <i className="bi bi-shop me-1"></i>
                {product.chain_name || "לא ידוע"}
              </span>

              <h2 className="fw-bold mb-3">{product.item_name || "מוצר"}</h2>
              <div
                className="sc-product-price mb-3"
                style={{ fontSize: "2.2rem" }}
              >
                ₪{product.price ?? "—"}
              </div>

              {/* Barcode display */}
              {product.barcode && (
                <div
                  className="mb-3"
                  style={{ fontSize: "0.8rem", color: "var(--sc-text-muted)" }}
                >
                  <i className="bi bi-upc-scan me-1"></i> ברקוד:{" "}
                  {product.barcode}
                </div>
              )}

              <div className="sc-divider"></div>

              {product.description && (
                <div className="mb-4">
                  <h6 className="fw-bold mb-2">תיאור</h6>
                  <p style={{ color: "var(--sc-text-muted)", lineHeight: 1.7 }}>
                    {product.description}
                  </p>
                </div>
              )}

              {/* Manufacturer info */}
              {product.manufacturer && product.manufacturer !== "לא ידוע" && (
                <div className="mb-4">
                  <h6 className="fw-bold mb-2">יצרן</h6>
                  <p style={{ color: "var(--sc-text-muted)" }}>
                    {product.manufacturer}
                  </p>
                </div>
              )}

              {/* Quantity selector */}
              <div className="d-flex align-items-center gap-3 mb-4">
                <label className="fw-bold" style={{ fontSize: "0.9rem" }}>
                  כמות:
                </label>
                <div className="d-flex align-items-center gap-2">
                  <button
                    className="sc-icon-btn"
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    aria-label="הקטן כמות"
                  >
                    <i className="bi bi-dash"></i>
                  </button>
                  <span
                    className="fw-bold"
                    style={{
                      minWidth: "30px",
                      textAlign: "center",
                      fontSize: "1.1rem",
                    }}
                  >
                    {quantity}
                  </span>
                  <button
                    className="sc-icon-btn"
                    onClick={() => setQuantity(quantity + 1)}
                    aria-label="הגדל כמות"
                  >
                    <i className="bi bi-plus"></i>
                  </button>
                </div>
              </div>

              {/* Add to list button */}
              <button
                className={`sc-btn ${isLinkedChild ? "sc-btn-ghost" : "sc-btn-primary"} w-100`}
                style={{ padding: "14px", fontSize: "1rem" }}
                onClick={handleAddToList}
              >
                {isLinkedChild ? (
                  <>
                    <i className="bi bi-send me-2"></i> בקש מההורים
                  </>
                ) : (
                  <>
                    <i className="bi bi-cart-plus me-2"></i> הוסף לרשימה
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Price History Chart */}
        {user && (
          <div className="row mt-4">
            <div className="col-12">
              <h5 className="fw-bold mb-3">
                <i
                  className="bi bi-graph-up me-2"
                  style={{ color: "var(--sc-primary)" }}
                ></i>
                היסטוריית מחירים
              </h5>
              <PriceHistoryChart productId={id} />
            </div>
          </div>
        )}
      </div>

      {/* List selection modal */}
      {showListModal && (
        <div
          className="sc-modal-overlay"
          onClick={() => setShowListModal(false)}
          dir="rtl"
        >
          <div
            className="sc-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "440px" }}
          >
            <div className="sc-modal-header">
              <h5>{isLinkedChild ? "בחר רשימה לבקשה" : "בחר רשימה"}</h5>
              <button
                className="sc-icon-btn"
                onClick={() => setShowListModal(false)}
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>
            <div
              className="sc-modal-body"
              style={{ maxHeight: "320px", overflowY: "auto" }}
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
                  <button
                    className="sc-btn sc-btn-primary mt-3"
                    onClick={() => {
                      setShowListModal(false);
                      navigate("/lists");
                    }}
                    style={{ fontSize: "0.85rem" }}
                  >
                    <i className="bi bi-plus-lg me-1"></i> צור רשימה
                  </button>
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
                            ? "rgba(99,102,241,0.08)"
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
              <button
                className="sc-btn sc-btn-ghost"
                onClick={() => setShowListModal(false)}
              >
                ביטול
              </button>
              <button
                className={`sc-btn ${isLinkedChild ? "sc-btn-ghost" : "sc-btn-primary"}`}
                onClick={confirmAddToList}
                disabled={!selectedListId || addingToList || lists.length === 0}
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
      )}
    </div>
  );
};

export default ProductPage;
