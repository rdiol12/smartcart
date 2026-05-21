import React, { useState, useEffect, useRef } from "react";
import api from "../api";
import { useNotify } from "../context/NotifyContext";

const ProductFilter = ({ onFilterChange }) => {
  const notify = useNotify();
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [sortBy, setSortBy] = useState("");

  // Latest onFilterChange held in a ref so the change-effect below depends
  // only on the actual filter values, not the parent's callback identity.
  // Inline `onFilterChange={(f) => ...}` from a parent would otherwise re-run
  // the effect every parent render.
  const onFilterChangeRef = useRef(onFilterChange);
  useEffect(() => {
    onFilterChangeRef.current = onFilterChange;
  }, [onFilterChange]);

  useEffect(() => {
    api
      .get("/api/categories")
      .then(({ data }) => setCategories(data.categories || []))
      .catch((err) =>
        notify(err.response?.data?.message || "שגיאה בטעינת המסננים"),
      );
  }, [notify]);

  useEffect(() => {
    onFilterChangeRef.current({
      category: selectedCategory,
      minPrice: minPrice || undefined,
      maxPrice: maxPrice || undefined,
      sort: sortBy || undefined,
    });
  }, [selectedCategory, minPrice, maxPrice, sortBy]);

  const handleReset = () => {
    setSelectedCategory("");
    setMinPrice("");
    setMaxPrice("");
    setSortBy("");
  };

  return (
    <div className="sc-filter-bar mb-3" dir="rtl">
      <div className="d-flex gap-2 align-items-end flex-wrap">
        <div>
          <label className="form-label mb-1" style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--sc-text-muted)" }}>קטגוריה</label>
          <select className="form-select form-select-sm sc-input" value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} style={{ minWidth: "130px" }}>
            <option value="">הכל</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div style={{ width: "95px" }}>
          <label className="form-label mb-1" style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--sc-text-muted)" }}>מחיר מינ'</label>
          <input type="number" className="form-control form-control-sm sc-input" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} placeholder="מ-" step="0.5" />
        </div>
        <div style={{ width: "95px" }}>
          <label className="form-label mb-1" style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--sc-text-muted)" }}>מחיר מקס'</label>
          <input type="number" className="form-control form-control-sm sc-input" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder="עד-" step="0.5" />
        </div>
        <div>
          <label className="form-label mb-1" style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--sc-text-muted)" }}>מיון</label>
          <select className="form-select form-select-sm sc-input" value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ minWidth: "160px" }}>
            <option value="">ברירת מחדל</option>
            <option value="price_asc">מחיר - נמוך לגבוה</option>
            <option value="price_desc">מחיר - גבוה לנמוך</option>
            <option value="name_asc">שם א-ת</option>
          </select>
        </div>
        <button className="sc-btn sc-btn-ghost" onClick={handleReset} style={{ fontSize: "0.8rem", padding: "6px 12px" }}>
          <i className="bi bi-x-circle me-1"></i> נקה
        </button>
      </div>
    </div>
  );
};

export default ProductFilter;
