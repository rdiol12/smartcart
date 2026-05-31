export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  if (!import.meta.env.PROD) {
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => regs.forEach((reg) => reg.unregister()))
      .catch(() => {});
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .then((reg) => console.log("Service Worker registered:", reg.scope))
      .catch((err) =>
        console.error("Service Worker registration failed:", err),
      );
  });

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent("pwa-installable", { detail: e }));
  });
}
