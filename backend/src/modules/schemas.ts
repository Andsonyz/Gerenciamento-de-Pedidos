import { z } from "zod";
import { HttpError } from "../errors.js";
import { orderSchema } from "../validation.js";
export const newOrder = orderSchema.safeExtend({ sessionId: z.string().uuid() });
export const id = z.string().uuid();
export const reason = z.string().trim().min(3).max(500);
const cents = z.number().int().min(0).max(100_000_000);
export const request = z.object({ requestId: id }).strict();
export const login = z
  .object({
    username: z.string().trim().min(1).max(80),
    password: z.string().min(1).max(200),
  })
  .strict();
export const user = z
  .object({
    username: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9._-]{3,80}$/),
    name: z.string().trim().min(2).max(100),
    role: z.enum(["admin", "cashier", "waiter", "kitchen"]),
    active: z.boolean(),
    password: z.string().min(12).max(200).optional(),
  })
  .strict();
export const product = z
  .object({
    name: z.string().trim().min(2).max(120),
    category: z.string().trim().min(1).max(80),
    priceCents: cents,
    active: z.boolean(),
    available: z.boolean(),
  })
  .strict();
export const category = z.object({ name: z.string().trim().min(1).max(80) }).strict();
export const tableStatus = z
  .object({ status: z.enum(["available", "reserved", "unavailable"]) })
  .strict();
export const orderStatus = z
  .object({ status: z.enum(["preparing", "ready", "delivered"]) })
  .strict();
export const adjustments = z
  .object({ discountCents: cents, serviceCents: cents, reason })
  .strict();
export const payment = z
  .object({
    requestId: id,
    method: z.enum(["cash", "pix", "debit", "credit", "other"]),
    amountCents: cents.min(1),
    tenderedCents: cents.optional(),
  })
  .strict();
export const refund = z
  .object({ requestId: id, amountCents: cents.min(1), reason })
  .strict();
export const close = z
  .object({
    requestId: id,
    exceptional: z.boolean().optional(),
    reason: reason.optional(),
  })
  .strict();
export const cancellation = z
  .object({
    requestId: id,
    reason,
    acknowledged: z.boolean().optional(),
    items: z
      .array(z.object({ itemId: id, quantity: z.number().int().min(1).max(99) }).strict())
      .min(1)
      .max(50)
      .refine((items) => new Set(items.map((i) => i.itemId)).size === items.length),
  })
  .strict();
export const resolution = z
  .object({ approve: z.boolean(), reason, acknowledged: z.boolean().optional() })
  .strict();
export const printStatus = z.object({ status: z.enum(["displayed", "failed"]) }).strict();
export const reprint = z.object({ requestId: id, reason }).strict();
export const settings = z
  .object({ name: z.string().trim().min(2).max(100), otherPaymentEnabled: z.boolean() })
  .strict();
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new HttpError(
      400,
      "Dados inválidos. Confira os campos, quantidades e limites informados.",
    );
  return parsed.data;
}
export function numericId(value: string | string[] | undefined) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1)
    throw new HttpError(400, "Identificador inválido.");
  return n;
}
