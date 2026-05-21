import { z } from "zod";

// Reusable primitives. We coerce because IDs frequently arrive as strings from
// the client (useParams() returns strings, form inputs are strings, etc.) — the
// strict z.number() variants rejected every real-time event in production.
const id = z.coerce.number().int().positive();
const nullableId = z.coerce.number().int().positive().nullable();
const num = z.coerce.number();

// One schema per socket event. Keep field names matching what the client sends.
export const joinListSchema = id;

export const sendItemSchema = z.object({
  listId: id,
  itemName: z.string().trim().min(1).max(200),
  price: num.nonnegative().nullable().optional(),
  storeName: z.string().max(100).nullable().optional(),
  quantity: num.positive().max(9999).nullable().optional(),
  productId: nullableId.optional(),
});

export const toggleItemSchema = z.object({
  itemId: id,
  listId: id,
  isChecked: z.boolean(),
});

export const deleteItemSchema = z.object({
  itemId: id,
  listId: id,
});

export const markPaidSchema = z.object({
  itemId: id,
  listId: id,
});

export const updateQuantitySchema = z.object({
  itemId: id,
  listId: id,
  quantity: num.positive().max(9999),
});

export const updateNoteSchema = z.object({
  itemId: id,
  listId: id,
  note: z.string().max(1000).nullable(),
});

export const createListSchema = z.object({
  list_name: z.string().trim().min(1).max(200),
});

export const addCommentSchema = z.object({
  itemId: id,
  listId: id,
  comment: z.string().trim().min(1).max(1000),
});

export const sendChatMessageSchema = z.object({
  listId: id,
  message: z.string().trim().min(1).max(2000),
});

export const assignItemSchema = z.object({
  itemId: id,
  listId: id,
  assignedTo: nullableId,
});

export const reorderItemsSchema = z.object({
  listId: id,
  items: z
    .array(z.object({ itemId: id, sortOrder: num.int() }))
    .min(1)
    .max(1000),
});
