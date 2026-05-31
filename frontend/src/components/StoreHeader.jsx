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
  onRefresh,
}) {
  // Show loading or refresh button based on state
  const showRefreshButton = onRefresh && searchQuery && !loading;
  const showLoadingSpinner = loading && searchQuery;

  // Calculate left position for icons based on what's visible
  const getIconLeftPosition = () => {
    if (searchQuery) {
      if (showRefreshButton) return "100px";
      if (showLoadingSpinner) return "70px";
      return "50px";
    }
    return "18px";
  };

  return (
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

      {/* Action buttons container */}
      {searchQuery && (
        <div
          className="d-flex align-items-center"
          style={{
            position: "absolute",
            left: "12px",
            top: "50%",
            transform: "translateY(-50%)",
            gap: "8px",
          }}
        >
          {/* Refresh button */}
          {showRefreshButton && (
            <button
              className="sc-icon-btn"
              onClick={onRefresh}
              aria-label="רענן תוצאות"
              style={{ padding: "4px" }}
            >
              <i className="bi bi-arrow-repeat"></i>
            </button>
          )}

          {/* Loading spinner */}
          {showLoadingSpinner && (
            <div
              className="spinner-border spinner-border-sm"
              style={{
                color: "var(--sc-primary)",
                width: "16px",
                height: "16px",
              }}
            />
          )}

          {/* Clear button */}
          <button
            className="sc-icon-btn"
            onClick={() => onSearchChange("")}
            aria-label="נקה חיפוש"
            style={{ padding: "4px" }}
          >
            <i className="bi bi-x-lg"></i>
          </button>
        </div>
      )}

      {/* Suggestions dropdown */}
      {showSuggestions && !searchQuery && recentSearches.length > 0 && (
        <div className="suggestions-dropdown">
          <div className="suggestions-header">
            <small>חיפושים אחרונים</small>
            <button onClick={clearRecentSearches} className="clear-btn-text">
              נקה הכל
            </button>
          </div>
          {recentSearches.map((query, idx) => (
            <div
              key={idx}
              onClick={() => selectRecentSearch(query)}
              className="suggestion-item"
            >
              <i className="bi bi-clock-history"></i>
              <span>{query}</span>
              <i className="bi bi-search"></i>
            </div>
          ))}
        </div>
      )}

      <style>{`
        .sc-store-search {
          max-width: 640px;
          margin-left: auto;
          margin-right: auto;
        }
        
        .search-icon {
          position: absolute;
          right: 16px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--sc-text-muted);
          pointer-events: none;
        }
        
        .sc-store-search input {
          width: 100%;
          padding: 14px 45px 14px 16px;
          border: 2px solid var(--sc-border);
          border-radius: var(--sc-radius);
          font-size: 1rem;
          background: var(--sc-surface);
          transition: all 0.2s ease;
        }
        
        .sc-store-search input:focus {
          outline: none;
          border-color: var(--sc-primary);
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
        }
        
        .sc-icon-btn {
          background: none;
          border: none;
          color: var(--sc-text-muted);
          cursor: pointer;
          padding: 4px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
        }
        
        .sc-icon-btn:hover {
          background: var(--sc-bg);
          color: var(--sc-text);
        }
        
        .sc-icon-btn:active {
          transform: scale(0.95);
        }
        
        .sc-icon-btn i {
          font-size: 1.1rem;
        }
        
        .suggestions-dropdown {
          position: absolute;
          top: calc(100% + 8px);
          left: 0;
          right: 0;
          background: var(--sc-surface);
          border: 1px solid var(--sc-border);
          border-radius: var(--sc-radius);
          box-shadow: var(--sc-shadow-lg);
          z-index: 100;
          overflow: hidden;
        }
        
        .suggestions-header {
          padding: 10px 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid var(--sc-border);
          background: var(--sc-bg);
        }
        
        .suggestions-header small {
          color: var(--sc-text-muted);
          font-weight: 600;
          font-size: 0.75rem;
        }
        
        .clear-btn-text {
          background: none;
          border: none;
          color: var(--sc-danger);
          font-size: 0.75rem;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 4px;
          transition: all 0.15s ease;
        }
        
        .clear-btn-text:hover {
          background: rgba(239, 68, 68, 0.1);
        }
        
        .suggestion-item {
          padding: 12px 16px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 12px;
          transition: background 0.15s ease;
        }
        
        .suggestion-item:hover {
          background: var(--sc-bg);
        }
        
        .suggestion-item i:first-child {
          color: var(--sc-text-muted);
          font-size: 0.9rem;
        }
        
        .suggestion-item span {
          flex: 1;
          font-size: 0.9rem;
        }
        
        .suggestion-item i:last-child {
          color: var(--sc-text-muted);
          font-size: 0.8rem;
          opacity: 0.5;
        }
        
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        
        .bi-arrow-repeat:hover {
          animation: spin 0.5s ease;
        }
      `}</style>
    </div>
  );
}
