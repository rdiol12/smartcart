// Service worker registration. Gated on `import.meta.env.PROD` so dev runs
// never install the SW — previously `npm run dev` registered the same SW
// that prod uses, which then cached dev-only paths (/src/main.jsx etc.)
// and stuck around after the dev server stopped. Users who later visited
// the prod site got served stale dev artifacts and had to clear site data
// by hand to recover.
//
// In dev mode we also actively unregister any leftover registration, so
// switching between `npm run dev` and `npm run build && npm run preview`
// on the same origin cleans up after itself.

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  if (!import.meta.env.PROD) {
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => regs.forEach((reg) => reg.unregister()))
      .catch(() => {});
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .then((reg) => console.log('Service Worker registered:', reg.scope))
      .catch((err) =>
        console.error('Service Worker registration failed:', err),
      );
  });

  // PWA install prompt — re-dispatch as a custom event so React components
  // can show their own UI for "add to home screen".
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window.dispatchEvent(
      new CustomEvent('pwa-installable', { detail: e }),
    );
  });
}
