/**
 * Centralized user-facing strings used in API responses and push payloads.
 *
 * The app is currently Hebrew-only, but having every dynamic-response string
 * routed through here means adding an English locale later is a swap in one
 * file rather than a grep through every route. Static text inside email
 * templates lives in `utils/emailTemplate.js` callers and isn't covered here
 * yet (separate concern — the email layer is templated differently).
 */

export const messages = {
  // POST /api/lists/:id/items — child account tried to add directly.
  child_cannot_add_item: "ילדים חייבים לבקש אישור מההורים להוספת פריטים",

  // Push notification fired from socket send_item.
  push_new_item_title: "פריט חדש ברשימה",
  push_new_item_body: (adderName, itemName) =>
    `${adderName || "Someone"} הוסיף ${itemName}`,

  // Fallback list name used in kid-request push payloads when the list
  // row vanished between the request and the lookup.
  fallback_list_name: "רשימה",
};
