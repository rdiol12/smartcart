import React, {
  createContext,
  useContext,
  useState,
  useMemo,
  useRef,
} from "react";

const NotifyContext = createContext(null);

function extractMessage(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    return (
      value.response?.data?.message || value.message || "Something went wrong"
    );
  }
  return "Something went wrong";
}

export function NotifyProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  // Expose both `notify(message, type)` (positional, existing callers) and
  // `notify.error / notify.success / notify.info` (named, clearer for new
  // callers). The function-with-methods shape keeps backwards compatibility
  // for the ~15 existing call sites while giving future callers a less
  // ambiguous API.
  const notify = useMemo(() => {
    const fn = (value, type = "error", durationMs = 5000) => {
      const id = ++idRef.current;
      const message = extractMessage(value);
      setToasts((prev) => [...prev, { id, message, type }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, durationMs);
    };
    fn.error = (value, durationMs) => fn(value, "error", durationMs);
    fn.success = (value, durationMs) => fn(value, "success", durationMs);
    fn.info = (value, durationMs) => fn(value, "info", durationMs);
    return fn;
  }, []);

  return (
    <NotifyContext.Provider value={notify}>
      {children}
      <div
        style={{
          position: "fixed",
          top: 20,
          right: 20,
          zIndex: 10000,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            style={{
              background:
                t.type === "error"
                  ? "#dc2626"
                  : t.type === "success"
                    ? "#16a34a"
                    : "#2563eb",
              color: "white",
              padding: "12px 16px",
              borderRadius: 6,
              boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
              maxWidth: 360,
              pointerEvents: "auto",
              fontSize: 14,
              lineHeight: 1.4,
            }}
          >
            {t.message}
          </div>
        ))}
      </div>
    </NotifyContext.Provider>
  );
}

export function useNotify() {
  const ctx = useContext(NotifyContext);
  if (!ctx) {
    throw new Error("useNotify must be used within NotifyProvider");
  }
  return ctx;
}
