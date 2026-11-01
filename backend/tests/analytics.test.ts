import { describe, expect, it } from "vitest";
import { Analytics, localDate } from "../src/modules/analytics.js";
import { Store } from "../src/database/store.js";
import { AuthService } from "../src/modules/auth.js";
import { Restaurant } from "../src/modules/restaurant.js";
import { VirtualPrinterAdapter } from "../src/printing/VirtualPrinterAdapter.js";
import { Finance } from "../src/modules/finance.js";
import { randomUUID } from "node:crypto";
import { Inventory } from "../src/modules/inventory.js";
import { Purchasing } from "../src/modules/purchasing.js";

describe("indicadores com dados registrados", () => {
  it("mantém recebimentos de outros fornecedores e arredonda reposição exatamente", () => {
    const db = new Store(":memory:");
    try {
      db.setClock(() => "2026-11-01T15:00:00.000Z");
      const user = new AuthService(db).saveUser(null, {
        username: "admin",
        name: "Admin",
        role: "admin",
        active: true,
        password: "Strong-password-123!",
      });
      const inv = new Inventory(db),
        buy = new Purchasing(db);
      const i = inv.saveIngredient(user, {
        name: "Farinha",
        unit: "g",
        minimum: 0,
        active: true,
      });
      inv.adjust(user, {
        requestId: randomUUID(),
        ingredientId: i.id,
        quantity: 9,
        kind: "initial",
        reason: "Saldo inicial",
      });
      inv.record(
        user,
        i.id,
        "consume",
        -9,
        0,
        0,
        "fixture-consumption",
        "Consumo de teste",
      );
      db.setClock(() => "2026-11-07T15:00:00.000Z");
      expect(new Analytics(db).report({ days: 21 }).replenishment[0]!.suggested).toBe(27);
      const a = buy.saveSupplier(user, {
        name: "Fornecedor A",
        phone: "",
        email: "",
        active: true,
        ingredientIds: [],
      });
      const b = buy.saveSupplier(user, {
        name: "Fornecedor B",
        phone: "",
        email: "",
        active: true,
        ingredientIds: [],
      });
      const p = buy.savePurchase(user, {
        requestId: randomUUID(),
        supplierId: b.id,
        notes: "",
        items: [{ ingredientId: i.id, quantity: 30, totalCents: 500 }],
      });
      buy.confirm(user, p.id, randomUUID());
      const report = new Analytics(db).report({ days: 21, supplierId: a.id });
      expect(report.replenishment[0]).toMatchObject({ incoming: 30, suggested: 0 });
      expect(report.purchases.pendingCount).toBe(0);
    } finally {
      db.close();
    }
  });
  it("usa o dia local e rejeita datas inválidas", () => {
    expect(localDate("2026-11-02T01:00:00.000Z", "America/Fortaleza")).toBe("2026-11-01");
    const db = new Store(":memory:");
    try {
      expect(() => new Analytics(db).report({ from: "2026-02-30" })).toThrow();
    } finally {
      db.close();
    }
  });
  it("separa valor dos pedidos e pagamentos, respeitando preços históricos", () => {
    const db = new Store(":memory:");
    try {
      db.setClock(() => "2026-11-01T15:00:00.000Z");
      const auth = new AuthService(db);
      const u = auth.saveUser(null, {
        username: "admin",
        name: "Admin",
        role: "admin",
        active: true,
        password: "Strong-password-123!",
      });
      const r = new Restaurant(db, new VirtualPrinterAdapter(db));
      const b = r.open(u, 1, randomUUID()).value;
      const product = r.products()[0]!;
      r.createOrder(u, {
        requestId: randomUUID(),
        tableId: 1,
        sessionId: b.id,
        notes: "",
        items: [{ productId: product.id, quantity: 2 }],
      });
      new Finance(r).pay(u, b.id, {
        requestId: randomUUID(),
        method: "pix",
        amountCents: 100,
      });
      const report = new Analytics(db).report({ from: "2026-11-01", to: "2026-11-01" });
      expect(report.ranking[0]).toMatchObject({
        ordered: 2,
        valid: 2,
        valueCents: product.priceCents * 2,
      });
      expect(report.paymentsCents).toBe(100);
      db.setClock(() => "2026-11-02T01:00:00.000Z");
      expect(r.dashboard().revenueTodayCents).toBe(100);
      db.setClock(() => "2026-11-02T04:00:00.000Z");
      expect(r.dashboard().revenueTodayCents).toBe(0);
      expect(report.refundedCents).toBe(0);
      expect(report.coverage.trackedProducts).toBe(0);
    } finally {
      db.close();
    }
  });
});
