import React from "react";

export default function StoreHeader({
  searchQuery,
  onSearchChange,
  showSuggestions,
  recentSearches,
  selectRecentSearch,
  clearRecentSearches,
  loading,
  onFocus,
  onBlur,
}) {
  return (
    <>
      <div className="sc-store-search mb-4" style={{ position: "relative" }}>
        <i className="bi bi-search search-icon"></i>
        <input
          type="text"
          placeholder="חפש מוצר..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          autoFocus
        />
        {searchQuery && (
          <button
            className="sc-icon-btn clear-btn"
            onClick={() => onSearchChange("")}
          >
            <i className="bi bi-x-lg"></i>
          </button>
        )}

        {loading && !recentSearches.length && (
          <div
            style={{
              position: "absolute",
              left: searchQuery ? "50px" : "18px",
              top: "50%",
              transform: "translateY(-50%)",
            }}
          >
            <div
              className="spinner-border spinner-border-sm"
              style={{
                color: "var(--sc-primary)",
                width: "18px",
                height: "18px",
              }}
            ></div>
          </div>
        )}

        {showSuggestions && !searchQuery && recentSearches.length > 0 && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 8px)",
              left: 0,
              right: 0,
              background: "var(--sc-surface)",
              border: "1px solid var(--sc-border)",
              borderRadius: "var(--sc-radius)",
              boxShadow: "var(--sc-shadow-lg)",
              padding: "8px 0",
              zIndex: 100,
              maxWidth: "640px",
              margin: "0 auto",
            }}
          >
            <div
              style={{
                padding: "8px 16px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                borderBottom: "1px solid var(--sc-border)",
              }}
            >
              <small style={{ color: "var(--sc-text-muted)", fontWeight: 600 }}>
                חיפושים אחרונים
              </small>
              <button
                onClick={clearRecentSearches}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--sc-danger)",
                  fontSize: "0.8rem",
                  cursor: "pointer",
                  padding: "2px 8px",
                }}
              >
                נקה
              </button>
            </div>
            {recentSearches.map((query, idx) => (
              <div
                key={idx}
                onClick={() => selectRecentSearch(query)}
                style={{
                  padding: "10px 16px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  transition: "background 0.15s ease",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "var(--sc-bg)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                <i
                  className="bi bi-clock-history"
                  style={{ color: "var(--sc-text-muted)", fontSize: "0.9rem" }}
                ></i>
                <span style={{ fontSize: "0.9rem" }}>{query}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
