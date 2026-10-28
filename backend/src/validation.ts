import { z } from "zod";
export const orderSchema = z
  .object({
    requestId: z.uuid(),
    tableId: z.number().int().positive(),
    items: z
      .array(
        z
          .object({
            productId: z.number().int().positive(),
            quantity: z.number().int().min(1).max(99),
          })
          .strict(),
      )
      .min(1)
      .max(50)
      .refine(
        (items) =>
          new Set(items.map((item) => item.productId)).size === items.length,
        "Não repita produtos; use a quantidade.",
      ),
    notes: z.string().trim().max(500).default(""),
  })
  .strict();
