import type { AnalyticsReport, Ingredient } from "@restaurante/shared";
import { Store } from "../database/store.js";
import { HttpError } from "../errors.js";
export function localDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}
function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export class Analytics {
  constructor(private db: Store) {}
  report(
    query: {
      from?: string;
      to?: string;
      category?: string;
      productId?: number;
      ingredientId?: string;
      supplierId?: string;
      days?: number;
    } = {},
  ): AnalyticsReport {
    const timeZone =
      this.db.get<{ time_zone?: string }>("SELECT * FROM restaurant_settings WHERE id=1")
        ?.time_zone || "America/Fortaleza";
    const today = localDate(this.db.timestamp(), timeZone);
    const from = query.from || today.slice(0, 8) + "01",
      to = query.to || today;
    if (
      !validDate(from) ||
      !validDate(to) ||
      from > to ||
      Date.parse(to) - Date.parse(from) > 366 * 86400000
    )
      throw new HttpError(400, "Selecione um período válido de até 366 dias.");
    const days = query.days ?? 7;
    if (!Number.isInteger(days) || days < 1 || days > 90)
      throw new HttpError(400, "Cobertura deve ser de 1 a 90 dias.");
    const inside = (iso: string) => {
      const d = localDate(iso, timeZone);
      return d >= from && d <= to;
    };
    const ranking = new Map<number, AnalyticsReport["ranking"][number]>();
    const orderItems = this.db.all<{
      productId: number;
      name: string;
      quantity: number;
      cancelled: number;
      price: number;
      createdAt: string;
      category: string;
    }>(
      "SELECT i.product_id as productId,i.name,i.quantity,i.cancelled_quantity as cancelled,i.price_cents as price,o.created_at as createdAt,c.name as category FROM order_items i JOIN service_orders o ON o.id=i.order_id JOIN menu_products p ON p.id=i.product_id JOIN categories c ON c.id=p.category_id",
    );
    for (const i of orderItems) {
      if (
        !inside(i.createdAt) ||
        (query.productId && i.productId !== query.productId) ||
        (query.category && i.category !== query.category)
      )
        continue;
      const row = ranking.get(i.productId) || {
        productId: i.productId,
        name: i.name,
        ordered: 0,
        cancelled: 0,
        valid: 0,
        valueCents: 0,
      };
      row.ordered += i.quantity;
      row.cancelled += i.cancelled;
      row.valid += i.quantity - i.cancelled;
      row.valueCents += (i.quantity - i.cancelled) * i.price;
      ranking.set(i.productId, row);
    }
    const sumMoney = (table: "payments" | "refunds") =>
      this.db
        .all<{ created_at: string; amount_cents: number }>(
          `SELECT created_at,amount_cents FROM ${table}`,
        )
        .filter((x) => inside(x.created_at))
        .reduce((s, x) => s + x.amount_cents, 0);
    let stock = this.db
      .all<Ingredient>(
        "SELECT i.id,i.name,i.unit,i.minimum,i.active,i.preferred_supplier_id as preferredSupplierId,i.tracking_since as trackingSince,COALESCE((SELECT SUM(quantity) FROM inventory_movements m WHERE m.ingredient_id=i.id),0) as physical,COALESCE((SELECT SUM(reserved_quantity) FROM inventory_reservations r WHERE r.ingredient_id=i.id),0) as reserved FROM ingredients i ORDER BY i.name",
      )
      .map((x) => ({ ...x, active: !!x.active, available: x.physical - x.reserved }));
    if (query.ingredientId) stock = stock.filter((x) => x.id === query.ingredientId);
    const moves = this.db.all<{
      ingredient_id: string;
      quantity: number;
      waste_quantity: number;
      created_at: string;
      kind: string;
    }>(
      "SELECT ingredient_id,quantity,waste_quantity,created_at,kind FROM inventory_movements WHERE kind IN ('consume','waste','loss')",
    );
    const consumption = stock.map((i) => ({
      ingredientId: i.id,
      name: i.name,
      unit: i.unit,
      consumed: moves
        .filter(
          (m) => m.ingredient_id === i.id && m.kind === "consume" && inside(m.created_at),
        )
        .reduce((s, m) => s - m.quantity, 0),
      wasted: moves
        .filter(
          (m) =>
            m.ingredient_id === i.id &&
            ["waste", "loss"].includes(m.kind) &&
            inside(m.created_at),
        )
        .reduce((s, m) => s + m.waste_quantity, 0),
    }));
    const allPurchases = this.db.all<{
      id: string;
      supplier_id: string;
      status: string;
      confirmed_at: string | null;
    }>("SELECT id,supplier_id,status,confirmed_at FROM purchases");
    const purchases = allPurchases.filter(
      (p) => !query.supplierId || p.supplier_id === query.supplierId,
    );
    const purchaseItems = this.db.all<{
      purchase_id: string;
      ingredient_id: string;
      quantity: number;
      received_quantity: number;
      total_cents: number;
    }>(
      "SELECT purchase_id,ingredient_id,quantity,received_quantity,total_cents FROM purchase_items",
    );
    const pending = purchases.filter((p) =>
      ["confirmed", "partially_received"].includes(p.status),
    );
    const receipts = this.db.all<{
      created_at: string;
      purchase_id: string;
      total_cents: number;
    }>(
      "SELECT r.created_at,r.purchase_id,i.total_cents FROM purchase_receipt_items i JOIN purchase_receipts r ON r.id=i.receipt_id",
    );
    const replenishment = stock
      .filter((i) => i.active)
      .map((i) => {
        const since = localDate(i.trackingSince, timeZone);
        const observedDays = Math.min(
          28,
          Math.max(1, Math.floor((Date.parse(today) - Date.parse(since)) / 86400000) + 1),
        );
        const beginning = new Date(Date.parse(today) - (observedDays - 1) * 86400000)
          .toISOString()
          .slice(0, 10);
        const consumed = moves
          .filter(
            (m) =>
              m.ingredient_id === i.id &&
              m.kind === "consume" &&
              localDate(m.created_at, timeZone) >= beginning &&
              localDate(m.created_at, timeZone) <= today,
          )
          .reduce((s, m) => s - m.quantity, 0);
        const averageDaily = consumed / observedDays;
        const incoming = purchaseItems
          .filter(
            (p) =>
              p.ingredient_id === i.id &&
              allPurchases.some(
                (x) =>
                  x.id === p.purchase_id &&
                  ["confirmed", "partially_received"].includes(x.status),
              ),
          )
          .reduce((s, p) => s + p.quantity - p.received_quantity, 0);
        const limitedHistory = observedDays < 7;
        return {
          ingredientId: i.id,
          name: i.name,
          unit: i.unit,
          available: i.available,
          minimum: i.minimum,
          incoming,
          averageDaily,
          observedDays,
          limitedHistory,
          suggested: Math.max(
            0,
            (limitedHistory
              ? 0
              : Number(
                  (BigInt(consumed) * BigInt(days) + BigInt(observedDays) - 1n) /
                    BigInt(observedDays),
                )) +
              i.minimum -
              i.available -
              incoming,
          ),
          preferredSupplierId: i.preferredSupplierId,
        };
      });
    return {
      from,
      to,
      timeZone,
      ranking: [...ranking.values()].sort((a, b) => b.valid - a.valid),
      paymentsCents: sumMoney("payments"),
      refundedCents: sumMoney("refunds"),
      stock,
      consumption,
      purchases: {
        confirmedCents: purchaseItems
          .filter((i) =>
            purchases.some(
              (p) => p.id === i.purchase_id && p.confirmed_at && inside(p.confirmed_at),
            ),
          )
          .reduce((s, i) => s + i.total_cents, 0),
        receivedCents: receipts
          .filter(
            (r) => inside(r.created_at) && purchases.some((p) => p.id === r.purchase_id),
          )
          .reduce((s, r) => s + r.total_cents, 0),
        pendingCount: pending.length,
      },
      replenishment,
      coverage: {
        totalProducts: this.db.get<{ n: number }>(
          "SELECT COUNT(*) n FROM menu_products WHERE active=1",
        )!.n,
        trackedProducts: this.db.get<{ n: number }>(
          "SELECT COUNT(*) n FROM menu_products p WHERE active=1 AND (SELECT active FROM recipe_versions r WHERE r.product_id=p.id ORDER BY version DESC LIMIT 1)=1",
        )!.n,
      },
    };
  }
}
