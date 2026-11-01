import { Router } from "express";
import { z } from "zod";
import { actor, allow } from "./modules/auth.js";
import {
  parse,
  id,
  numericId,
  reason,
  request as requestSchema,
} from "./modules/schemas.js";
import { Restaurant } from "./modules/restaurant.js";
import { Inventory } from "./modules/inventory.js";
import { Recipes } from "./modules/recipes.js";
import { Purchasing } from "./modules/purchasing.js";
import { Analytics } from "./modules/analytics.js";
import type { StateChange } from "@restaurante/shared";
const quantity = z.number().int().min(0).max(1_000_000_000);
const ingredient = z
  .object({
    name: z.string().trim().min(1).max(120),
    unit: z.enum(["g", "ml", "un"]),
    minimum: quantity,
    active: z.boolean(),
    preferredSupplierId: id.nullable().optional(),
  })
  .strict();
const recipe = z
  .object({
    active: z.boolean(),
    items: z
      .array(z.object({ ingredientId: id, quantity: quantity.min(1) }).strict())
      .max(100),
  })
  .strict();
const supplier = z
  .object({
    name: z.string().trim().min(1).max(120),
    phone: z.string().max(80),
    email: z.string().max(160),
    active: z.boolean(),
    ingredientIds: z.array(id).max(500),
  })
  .strict();
const purchase = z
  .object({
    requestId: id,
    supplierId: id,
    notes: z.string().max(1000),
    items: z
      .array(
        z
          .object({
            ingredientId: id,
            quantity: quantity.min(1),
            totalCents: z.number().int().min(0).max(100_000_000),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export function operationsRoutes(
  r: Restaurant,
  notify: (scope: StateChange["scope"], id: string) => void,
) {
  const router = Router(),
    office = allow("admin", "cashier"),
    admin = allow("admin");
  const inventory = new Inventory(r.db),
    recipes = new Recipes(r.db),
    purchasing = new Purchasing(r.db);
  router.get("/ingredients", office, (_req, res) => res.json(inventory.stock()));
  router.post("/ingredients", admin, (req, res) => {
    const v = inventory.saveIngredient(actor(res), parse(ingredient, req.body));
    notify("catalog", v.id);
    res.status(201).json(v);
  });
  router.patch("/ingredients/:id", admin, (req, res) => {
    const v = inventory.saveIngredient(
      actor(res),
      parse(ingredient, req.body),
      parse(id, req.params.id),
    );
    notify("catalog", v.id);
    res.json(v);
  });
  router.get("/inventory", office, (_req, res) => res.json(inventory.stock()));
  router.get("/inventory/movements", office, (req, res) =>
    res.json(
      inventory.movements(
        parse(
          z
            .object({
              page: z.coerce.number().int().min(1).optional(),
              ingredientId: id.optional(),
            })
            .strict(),
          req.query,
        ),
      ),
    ),
  );
  router.post("/inventory/adjustments", admin, (req, res) => {
    const v = inventory.adjust(
      actor(res),
      parse(
        z
          .object({
            requestId: id,
            ingredientId: id,
            quantity: z.number().int().min(-1_000_000_000).max(1_000_000_000),
            kind: z.enum(["initial", "adjustment", "loss"]),
            reason,
            overrideReason: reason.optional(),
          })
          .strict(),
        req.body,
      ),
    );
    notify("catalog", "inventory");
    res.json(v.value);
  });
  router.get("/products/:id/recipes", office, (req, res) =>
    res.json(recipes.get(numericId(req.params.id))),
  );
  router.post("/products/:id/recipes", admin, (req, res) => {
    const v = recipes.save(actor(res), numericId(req.params.id), parse(recipe, req.body));
    notify("catalog", String(v.productId));
    res.status(201).json(v);
  });
  router.get("/suppliers", office, (_req, res) => res.json(purchasing.listSuppliers()));
  router.post("/suppliers", admin, (req, res) => {
    const v = purchasing.saveSupplier(actor(res), parse(supplier, req.body));
    notify("catalog", v.id);
    res.status(201).json(v);
  });
  router.patch("/suppliers/:id", admin, (req, res) => {
    const v = purchasing.saveSupplier(
      actor(res),
      parse(supplier, req.body),
      parse(id, req.params.id),
    );
    notify("catalog", v.id);
    res.json(v);
  });
  router.get("/purchases", office, (req, res) =>
    res.json(
      purchasing.list(
        parse(
          z
            .object({
              page: z.coerce.number().int().min(1).optional(),
              status: z
                .enum([
                  "draft",
                  "confirmed",
                  "partially_received",
                  "received",
                  "cancelled",
                ])
                .optional(),
              supplierId: id.optional(),
            })
            .strict(),
          req.query,
        ),
      ),
    ),
  );
  router.get("/purchases/:id", office, (req, res) =>
    res.json(purchasing.get(parse(id, req.params.id))),
  );
  router.post("/purchases", admin, (req, res) => {
    const v = purchasing.savePurchase(actor(res), parse(purchase, req.body));
    notify("catalog", v.id);
    res.status(201).json(v);
  });
  router.patch("/purchases/:id", admin, (req, res) => {
    const v = purchasing.savePurchase(
      actor(res),
      parse(purchase, req.body),
      parse(id, req.params.id),
    );
    notify("catalog", v.id);
    res.json(v);
  });
  router.post("/purchases/:id/confirm", admin, (req, res) => {
    const v = purchasing.confirm(
      actor(res),
      parse(id, req.params.id),
      parse(requestSchema, req.body).requestId,
    );
    notify("catalog", v.value.id);
    res.json(v.value);
  });
  router.post("/purchases/:id/cancel", admin, (req, res) => {
    const input = parse(z.object({ requestId: id, reason }).strict(), req.body);
    const v = purchasing.cancel(
      actor(res),
      parse(id, req.params.id),
      input.requestId,
      input.reason,
    );
    notify("catalog", v.value.id);
    res.json(v.value);
  });
  router.post("/purchases/:id/receive", admin, (req, res) => {
    const input = parse(
      z
        .object({
          requestId: id,
          items: z
            .array(z.object({ itemId: id, quantity: quantity.min(1) }).strict())
            .min(1)
            .max(100),
        })
        .strict(),
      req.body,
    );
    const v = purchasing.receive(actor(res), parse(id, req.params.id), input);
    notify("catalog", v.value.id);
    res.json(v.value);
  });
  router.get("/ingredients/:id/price-history", office, (req, res) =>
    res.json(purchasing.priceHistory(parse(id, req.params.id))),
  );
  router.get("/analytics", office, (req, res) =>
    res.json(
      new Analytics(r.db).report(
        parse(
          z
            .object({
              from: z.string().optional(),
              to: z.string().optional(),
              category: z.string().max(80).optional(),
              productId: z.coerce.number().int().min(1).optional(),
              ingredientId: id.optional(),
              supplierId: id.optional(),
              days: z.coerce.number().int().min(1).max(90).optional(),
            })
            .strict(),
          req.query,
        ),
      ),
    ),
  );
  return router;
}
