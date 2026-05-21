import { z } from "zod";

// Reusable primitives. We coerce because IDs frequently arrive as strings from
// the client (useParams() returns strings, form inputs are strings, etc.) — the
// strict z.number() variants rejected every real-time event in production.
const id = z.coerce.number().int().positive();
const nullableId = z.coerce.number().int().positive().nullable();
const num = z.coerce.number();

// Stamp the schema with its event name so parseSocketPayload's failure log
// can identify which event the bad payload came from. Without this every
// validation-failure log said `event=?` — useless when triaging.
function named(eventName, schema) {
  schema._eventName = eventName;
  return schema;
}

export const joinListSchema = named("join_list", id);

export const sendItemSchema = named(
  "send_item",
  z.object({
    listId: id,
    itemName: z.string().trim().min(1).max(200),
    price: num.nonnegative().nullable().optional(),
    storeName: z.string().max(100).nullable().optional(),
    quantity: num.positive().max(9999).nullable().optional(),
    productId: nullableId.optional(),
  }),
);

export const toggleItemSchema = named(
  "toggle_item",
  z.object({
    itemId: id,
    listId: id,
    isChecked: z.boolean(),
  }),
);

export const deleteItemSchema = named(
  "delete_item",
  z.object({
    itemId: id,
    listId: id,
  }),
);

export const markPaidSchema = named(
  "mark_paid",
  z.object({
    itemId: id,
    listId: id,
  }),
);

export const updateQuantitySchema = named(
  "update_quantity",
  z.object({
    itemId: id,
    listId: id,
    quantity: num.positive().max(9999),
  }),
);

export const updateNoteSchema = named(
  "update_note",
  z.object({
    itemId: id,
    listId: id,
    note: z.string().max(1000).nullable(),
  }),
);

export const createListSchema = named(
  "create_list",
  z.object({
    list_name: z.string().trim().min(1).max(200),
  }),
);

export const addCommentSchema = named(
  "add_comment",
  z.object({
    itemId: id,
    listId: id,
    comment: z.string().trim().min(1).max(1000),
  }),
);

export const sendChatMessageSchema = named(
  "send_chat_message",
  z.object({
    listId: id,
    message: z.string().trim().min(1).max(2000),
  }),
);

export const assignItemSchema = named(
  "assign_item",
  z.object({
    itemId: id,
    listId: id,
    assignedTo: nullableId,
  }),
);

export const reorderItemsSchema = named(
  "reorder_items",
  z.object({
    listId: id,
    items: z
      .array(z.object({ itemId: id, sortOrder: num.int() }))
      .min(1)
      .max(1000),
  }),
);
