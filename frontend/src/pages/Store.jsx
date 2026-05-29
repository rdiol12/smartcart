import React, {
  useState,
  useRef,
  useContext,
  useCallback,
  useMemo,
} from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import api from "../api";
import { useNotify } from "../context/NotifyContext";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import ProductFilter from "../components/ProductFilter";
import StoreHeader from "../components/StoreHeader";
import ProductList from "../components/ProductList";
import AddToListModal from "../components/AddToListModal";

// Request cache to prevent duplicate API calls
class RequestCache {
  constructor() {
    this.pendingRequests = new Map();
    this.cache = new Map();
  }

  async request(key, requestFn, ttl = 30000) {
    // Check for pending request
    if (this.pendingRequests.has(key)) {
      return this.pendingRequests.get(key);
    }

    // Check cache
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < ttl) {
      return cached.data;
    }

    // Make request
    const promise = requestFn()
      .then((data) => {
        this.cache.set(key, { data, timestamp: Date.now() });
        return data;
      })
      .finally(() => {
        this.pendingRequests.delete(key);
      });

    this.pendingRequests.set(key, promise);
    return promise;
  }

  clear() {
    this.pendingRequests.clear();
    this.cache.clear();
  }

  // Method to invalidate specific cache entry
  invalidate(key) {
    this.cache.delete(key);
  }
}

const requestCache = new RequestCache();

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
  const [refreshKey, setRefreshKey] = useState(0); // Add refresh key to force re-renders
  const searchTimeoutRef = useRef(null);
  const abortControllerRef = useRef(null);
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
        localStorage.removeItem("smartcart-recent-searches");
      }
    }

    // Cleanup on unmount
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  // Save search to recent
  const saveRecentSearch = useCallback((query) => {
    if (!query.trim()) return;
    setRecentSearches((prev) => {
      const updated = [query, ...prev.filter((s) => s !== query)].slice(0, 5);
      localStorage.setItem(
        "smartcart-recent-searches",
        JSON.stringify(updated),
      );
      return updated;
    });
  }, []);

  // Fetch products with caching and abort support
  const fetchProducts = useCallback(
    async (reset = false) => {
      const q = searchRef.current.trim();
      if (!q) {
        if (reset) setProducts([]);
        setHasMore(false);
        setLoading(false);
        return;
      }

      // Abort previous request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();

      const currentOffset = reset ? 0 : offsetRef.current;

      // Create cache key from request params
      const params = new URLSearchParams({ limit, offset: currentOffset, q });
      const f = filtersRef.current;
      if (f.category) params.append("category", f.category);
      if (f.minPrice) params.append("minPrice", f.minPrice);
      if (f.maxPrice) params.append("maxPrice", f.maxPrice);
      if (f.sort) params.append("sort", f.sort);

      const cacheKey = `/api/search?${params.toString()}`;

      try {
        const response = await requestCache.request(
          cacheKey,
          async () => {
            const res = await api.get(cacheKey, {
              signal: abortControllerRef.current.signal,
            });
            return res.data;
          },
          30000, // 30 second cache for search results
        );

        const newProducts = Array.isArray(response?.rows) ? response.rows : [];

        if (reset) {
          setProducts(newProducts);
        } else {
          setProducts((prev) => {
            // Avoid duplicates
            const existingIds = new Set(
              prev.map((p) => `${p.item_id}-${p.chain_id}`),
            );
            const uniqueNew = newProducts.filter(
              (p) => !existingIds.has(`${p.item_id}-${p.chain_id}`),
            );
            return [...prev, ...uniqueNew];
          });
        }

        offsetRef.current =
          response?.nextOffset || currentOffset + newProducts.length;
        setHasMore(response?.hasMore ?? false);
      } catch (err) {
        if (err.name !== "AbortError" && err.code !== "ERR_CANCELED") {
          console.error("Fetch error:", err);
          notify(err.response?.data?.message || "שגיאה בטעינת תוצאות החיפוש");
        }
        setHasMore(false);
      } finally {
        setLoading(false);
      }
    },
    [limit, notify],
  );

  // Function to refresh current search (invalidate cache)
  const refreshSearch = useCallback(() => {
    if (searchRef.current.trim()) {
      // Invalidate cache for current search
      const params = new URLSearchParams({
        limit,
        offset: 0,
        q: searchRef.current.trim(),
      });
      const f = filtersRef.current;
      if (f.category) params.append("category", f.category);
      if (f.minPrice) params.append("minPrice", f.minPrice);
      if (f.maxPrice) params.append("maxPrice", f.maxPrice);
      if (f.sort) params.append("sort", f.sort);

      const cacheKey = `/api/search?${params.toString()}`;
      requestCache.invalidate(cacheKey);

      // Refresh the products
      offsetRef.current = 0;
      setLoading(true);
      fetchProducts(true);
      setRefreshKey((prev) => prev + 1);
    }
  }, [limit, fetchProducts]);

  const handleFilterChange = useCallback(
    (newFilters) => {
      filtersRef.current = newFilters;
      if (searchRef.current.trim()) {
        offsetRef.current = 0;
        setLoading(true);
        setSearched(true);
        fetchProducts(true);
      }
    },
    [fetchProducts],
  );

  const handleSearchChange = useCallback(
    (value) => {
      setSearchQuery(value);
      searchRef.current = value;

      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }

      if (!value.trim()) {
        setProducts([]);
        setSearched(false);
        setHasMore(false);
        setShowSuggestions(true);
        return;
      }

      setShowSuggestions(false);

      // Debounce search with longer delay to prevent rapid requests
      searchTimeoutRef.current = setTimeout(() => {
        offsetRef.current = 0;
        setLoading(true);
        setSearched(true);
        saveRecentSearch(value);
        fetchProducts(true);
      }, 500);
    },
    [fetchProducts, saveRecentSearch],
  );

  const selectRecentSearch = useCallback(
    (query) => {
      setSearchQuery(query);
      searchRef.current = query;
      setShowSuggestions(false);
      offsetRef.current = 0;
      setLoading(true);
      setSearched(true);
      fetchProducts(true);
    },
    [fetchProducts],
  );

  const clearRecentSearches = useCallback(() => {
    setRecentSearches([]);
    localStorage.removeItem("smartcart-recent-searches");
  }, []);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      setLoading(true);
      fetchProducts(false);
    }
  }, [loading, hasMore, fetchProducts]);

  const handleAddToList = useCallback(
    async (product) => {
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
    },
    [user, notify],
  );

  const confirmAddToList = useCallback(async () => {
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
  }, [selectedListId, selectedProduct, lists, isLinkedChild, quantity, notify]);

  // Memoize ProductList props to prevent unnecessary re-renders
  const productListProps = useMemo(
    () => ({
      products,
      user,
      isLinkedChild,
      handleAddToList,
      hasMore,
      loadMore,
      loading,
      searchQuery,
      refreshKey, // Add refreshKey to trigger re-renders when needed
    }),
    [
      products,
      user,
      isLinkedChild,
      handleAddToList,
      hasMore,
      loadMore,
      loading,
      searchQuery,
      refreshKey,
    ],
  );

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
          onRefresh={refreshSearch} // Pass refresh callback to header
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

        {products.length > 0 && <ProductList {...productListProps} />}
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
