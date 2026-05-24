import React, { useState, useRef, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import api from "../api";
import { useNotify } from "../context/NotifyContext";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import ProductFilter from "../components/ProductFilter";
import StoreHeader from "../components/StoreHeader";
import ProductList from "../components/ProductList";
import AddToListModal from "../components/AddToListModal";

const Store = () => {
  const { user, isLinkedChild } = useContext(AuthContext);
  const navigate = useNavigate();
  const notify = useNotify();
  const [products, setProducts] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searched, setSearched] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [recentSearches, setRecentSearches] = useState([]);
  const searchTimeoutRef = useRef(null);
  const limit = 20;
  const offsetRef = useRef(0);
  const searchRef = useRef("");
  const filtersRef = useRef({});

  const [selectedProduct, setSelectedProduct] = useState(null);
  const [lists, setLists] = useState([]);
  const [selectedListId, setSelectedListId] = useState(null);
  const [addingToList, setAddingToList] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [quantity, setQuantity] = useState(1);

  useBodyScrollLock(selectedProduct !== null);

  // Load recent searches on mount
  React.useEffect(() => {
    const saved = localStorage.getItem("smartcart-recent-searches");
    if (saved) {
      try {
        setRecentSearches(JSON.parse(saved));
      } catch (_e) {
        // Corrupted storage value — drop it silently. Not user-actionable.
        localStorage.removeItem("smartcart-recent-searches");
      }
    }
  }, []);

  // Save search to recent
  const saveRecentSearch = (query) => {
    if (!query.trim()) return;
    const updated = [query, ...recentSearches.filter((s) => s !== query)].slice(
      0,
      5,
    );
    setRecentSearches(updated);
    localStorage.setItem("smartcart-recent-searches", JSON.stringify(updated));
  };

  const fetchProducts = async (reset = false) => {
    const q = searchRef.current.trim();
    if (!q) {
      if (reset) setProducts([]);
      setHasMore(false);
      setLoading(false);
      return;
    }
    const currentOffset = reset ? 0 : offsetRef.current;
    try {
      const params = new URLSearchParams({ limit, offset: currentOffset, q });
      const f = filtersRef.current;
      if (f.category) params.append("category", f.category);
      if (f.minPrice) params.append("minPrice", f.minPrice);
      if (f.maxPrice) params.append("maxPrice", f.maxPrice);
      if (f.sort) params.append("sort", f.sort);
      const response = await api.get(`/api/search?${params.toString()}`);
      const newProducts = Array.isArray(response.data?.rows)
        ? response.data.rows
        : [];
      if (reset) setProducts(newProducts);
      else setProducts((prev) => [...prev, ...newProducts]);

      offsetRef.current =
        response.data?.nextOffset || currentOffset + newProducts.length;
      setHasMore(response.data?.hasMore ?? false);
    } catch (err) {
      notify(err.response?.data?.message || "שגיאה בטעינת תוצאות החיפוש");
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (newFilters) => {
    filtersRef.current = newFilters;
    if (searchRef.current.trim()) {
      offsetRef.current = 0;
      setLoading(true);
      setSearched(true);
      fetchProducts(true);
    }
  };

  const handleSearchChange = (value) => {
    setSearchQuery(value);
    searchRef.current = value;
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (!value.trim()) {
      setProducts([]);
      setSearched(false);
      setHasMore(false);
      setShowSuggestions(true);
      return;
    }
    setShowSuggestions(false);
    searchTimeoutRef.current = setTimeout(() => {
      offsetRef.current = 0;
      setLoading(true);
      setSearched(true);
      saveRecentSearch(value);
      fetchProducts(true);
    }, 300);
  };

  const selectRecentSearch = (query) => {
    setSearchQuery(query);
    searchRef.current = query;
    setShowSuggestions(false);
    offsetRef.current = 0;
    setLoading(true);
    setSearched(true);
    fetchProducts(true);
  };

  const clearRecentSearches = () => {
    setRecentSearches([]);
    localStorage.removeItem("smartcart-recent-searches");
  };

  const loadMore = () => {
    if (!loading && hasMore) {
      setLoading(true);
      fetchProducts(false);
    }
  };

  const handleAddToList = async (product) => {
    if (!user) return;
    setSelectedProduct(product);
    setQuantity(1);
    setSelectedListId(null);
    try {
      const { data } = await api.get("/api/lists");
      setLists(data.lists);
    } catch (err) {
      notify(err.response?.data?.message || "שגיאה בטעינת הרשימות");
    }
  };

  const confirmAddToList = async () => {
    if (!selectedListId || !selectedProduct) return;
    setAddingToList(true);
    try {
      const selectedList = lists.find((l) => l.id === selectedListId);
      if (isLinkedChild) {
        await api.post("/api/family/kid-requests", {
          listId: selectedListId,
          itemName: selectedProduct.item_name,
          price: selectedProduct.price || null,
          storeName: selectedProduct.chain_name || null,
          quantity,
          productId: selectedProduct.item_id || null,
        });
        setSuccessMsg("הבקשה נשלחה לאישור ההורה!");
      } else {
        await api.post(`/api/lists/${selectedListId}/items`, {
          itemName: selectedProduct.item_name,
          price: selectedProduct.price || null,
          storeName: selectedProduct.chain_name || null,
          quantity,
          productId: selectedProduct.item_id || null,
        });
        setSuccessMsg(
          `"${selectedProduct.item_name}" נוסף לרשימה "${selectedList?.list_name}"!`,
        );
      }
      setSelectedProduct(null);
      setSelectedListId(null);
      setTimeout(() => setSuccessMsg(""), 4000);
    } catch (err) {
      notify(err.response?.data?.message || "שגיאה בהוספת המוצר");
    } finally {
      setAddingToList(false);
    }
  };

  return (
    <div className="page-fade-in" dir="rtl">
      <div className="container py-4">
        {/* Header */}
        <div className="text-center mb-4">
          <h2 className="fw-bold mb-2">חיפוש מוצרים</h2>
          <p
            style={{
              color: "var(--sc-text-muted)",
              fontSize: "0.9rem",
              margin: 0,
            }}
          >
            חפש מוצרים והוסף ישירות לרשימת הקניות
          </p>
        </div>

        <StoreHeader
          searchQuery={searchQuery}
          onSearchChange={handleSearchChange}
          showSuggestions={showSuggestions}
          recentSearches={recentSearches}
          selectRecentSearch={selectRecentSearch}
          clearRecentSearches={clearRecentSearches}
          loading={loading}
          onFocus={() => !searchQuery && setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
        />

        {/* Success */}
        {successMsg && (
          <div
            style={{
              maxWidth: "640px",
              margin: "0 auto 16px",
              padding: "12px 20px",
              borderRadius: "var(--sc-radius)",
              background: "rgba(16,185,129,0.08)",
              border: "1px solid rgba(16,185,129,0.2)",
              color: "var(--sc-success)",
              fontSize: "0.9rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
            }}
          >
            <i className="bi bi-check-circle-fill"></i>
            {successMsg}
          </div>
        )}

        {/* Loading */}
        {loading && products.length === 0 && (
          <div className="text-center py-5">
            <div className="sc-spinner" style={{ margin: "0 auto" }}></div>
          </div>
        )}

        {/* Before search */}
        {!searched && !loading && products.length === 0 && (
          <div className="text-center py-5" style={{ opacity: 0.5 }}>
            <i
              className="bi bi-basket3"
              style={{ fontSize: "3.5rem", color: "var(--sc-primary)" }}
            ></i>
            <p
              className="mt-3 mb-0"
              style={{ color: "var(--sc-text-muted)", fontSize: "1rem" }}
            >
              הקלד שם מוצר כדי לחפש
            </p>
          </div>
        )}

        {/* No results */}
        {searched && !loading && products.length === 0 && (
          <div className="text-center py-5">
            <i
              className="bi bi-emoji-frown"
              style={{
                fontSize: "2.5rem",
                color: "var(--sc-text-muted)",
                opacity: 0.4,
              }}
            ></i>
            <h5 className="mt-3 fw-bold">לא נמצאו תוצאות</h5>
            <p style={{ color: "var(--sc-text-muted)" }}>
              נסה לחפש עם מילים אחרות
            </p>
          </div>
        )}

        {/* Filter bar — shown once the user has searched at least once. */}
        {searched && <ProductFilter onFilterChange={handleFilterChange} />}

        {products.length > 0 && (
          <ProductList
            products={products}
            user={user}
            isLinkedChild={isLinkedChild}
            handleAddToList={handleAddToList}
            hasMore={hasMore}
            loadMore={loadMore}
            loading={loading}
            searchQuery={searchQuery}
          />
        )}
      </div>

      <AddToListModal
        selectedProduct={selectedProduct}
        onClose={() => setSelectedProduct(null)}
        quantity={quantity}
        setQuantity={setQuantity}
        lists={lists}
        selectedListId={selectedListId}
        setSelectedListId={setSelectedListId}
        confirmAddToList={confirmAddToList}
        addingToList={addingToList}
        isLinkedChild={isLinkedChild}
        successMsg={successMsg}
      />
    </div>
  );
};

export default Store;
