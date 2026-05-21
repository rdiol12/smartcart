import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Bootstrap CSS (RTL build) — Vite versions + tree-shakes it. The Bootstrap
// JS bundle is intentionally not imported; nothing in src/ uses it.
// App.css imports after, so our overrides win.
import "bootstrap/dist/css/bootstrap.rtl.min.css";
import "./App.css";
import App from "./App.jsx";
import { registerServiceWorker } from "./registerSW.js";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();
