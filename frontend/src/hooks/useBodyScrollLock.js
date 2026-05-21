import { useEffect } from "react";

/**
 * Lock `document.body` scrolling while `active` is true. Restores whatever
 * `overflow` value the body had before the lock so multiple stacked modals
 * (or a navigation away from a still-open modal) don't strand the page in
 * "can't scroll" state.
 *
 * Every modal in the app uses .sc-modal-overlay positioned over the page,
 * but without locking the body the user can still scroll the underlying
 * list/page on mobile while the modal is open — content rolls around
 * behind a "stationary" dialog.
 */
export function useBodyScrollLock(active) {
  useEffect(() => {
    if (!active) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);
}
