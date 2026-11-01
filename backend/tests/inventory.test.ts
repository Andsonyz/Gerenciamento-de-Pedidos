import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Store } from "../src/database/store.js";
import { AuthService } from "../src/modules/auth.js";
import { Inventory, convertQuantity } from "../src/modules/inventory.js";
import { Recipes } from "../src/modules/recipes.js";
import { Purchasing } from "../src/modules/purchasing.js";
import { operationsSchema } from "../src/database/operations-schema.js";
import { seedSimulationInventory } from "../src/modules/demo-inventory.js";
import type { PremiumOrder, User } from "@restaurante/shared";

let db: Store, inventory: Inventory, recipes: Recipes, purchases: Purchasing;
let admin: User, waiter: User;
beforeEach(() => {
  db = new Store(":memory:");
  db.raw.exec(operationsSchema);
  const auth = new AuthService(db);
  auth.bootstrap({ username: "admin", name: "Admin", password: "Long-password-123!" });
  admin = auth.users()[0]!;
  waiter = auth.saveUser(admin.id, {
    username: "waiter",
    name: "Waiter",
    role: "waiter",
    active: true,
    password: "Long-password-123!",
  });
  inventory = new Inventory(db);
  recipes = new Recipes(db);
  purchases = new Purchasing(db);
});
afterEach(() => db?.close());

function ingredient(quantity = 1000) {
  const result = inventory.saveIngredient(admin, {
    name: "Carne",
    unit: "g",
    minimum: 100,
    active: true,
  });
  if (quantity)
    inventory.adjust(admin, {
      requestId: randomUUID(),
      ingredientId: result.id,
      quantity,
      kind: "initial",
      reason: "Inventário inicial",
    });
  return inventory.stock().find((i) => i.id === result.id)!;
}
function order(quantity: number): PremiumOrder {
  const id = randomUUID(),
    sessionId = randomUUID(),
    itemId = randomUUID();
  db.run(
    "INSERT INTO table_sessions(id,table_id,opened_at) VALUES(?,1,?)",
    sessionId,
    new Date().toISOString(),
  );
  db.run(
    "INSERT INTO service_orders(id,request_id,session_id,user_id,created_at,notes,status) VALUES(?,?,?,?,?,'','received')",
    id,
    randomUUID(),
    sessionId,
    waiter.id,
    new Date().toISOString(),
  );
  db.run(
    "INSERT INTO order_items(id,order_id,product_id,name,quantity,price_cents) VALUES(?,?,1,'Prato',?,2800)",
    itemId,
    id,
    quantity,
  );
  return {
    id,
    number: 1,
    requestId: randomUUID(),
    tableId: 1,
    sessionId,
    userId: waiter.id,
    userName: waiter.name,
    createdAt: new Date().toISOString(),
    notes: "",
    status: "received",
    items: [
      {
        id: itemId,
        productId: 1,
        name: "Prato",
        quantity,
        cancelledQuantity: 0,
        priceCents: 2800,
      },
    ],
  };
}

describe("ingredientes, reservas e consumo", () => {
  it("converte unidades sem perder precisão nem converter massa em volume", () => {
    expect(convertQuantity("1.125", "kg", "g")).toBe(1125);
    expect(convertQuantity("0,001", "l", "ml")).toBe(1);
    expect(() => convertQuantity("0.0001", "kg", "g")).toThrow();
    expect(() => convertQuantity("1", "kg", "ml")).toThrow();
    expect(() => convertQuantity("1.2", "un", "un")).toThrow();
  });
  it("preserva a receita e libera cancelamento antes do preparo sem devolver consumo posterior", () => {
    const meat = ingredient();
    recipes.save(admin, 1, {
      active: true,
      items: [{ ingredientId: meat.id, quantity: 200 }],
    });
    const o = order(4);
    db.tx(() => inventory.reserve(waiter, o));
    expect(inventory.stock()[0]).toMatchObject({
      physical: 1000,
      reserved: 800,
      available: 200,
    });
    recipes.save(admin, 1, {
      active: true,
      items: [{ ingredientId: meat.id, quantity: 300 }],
    });
    db.tx(() =>
      inventory.cancel(
        admin,
        o,
        [{ itemId: o.items[0]!.id, quantity: 1 }],
        "Cliente desistiu",
      ),
    );
    o.items[0]!.cancelledQuantity = 1;
    db.tx(() => inventory.consume(admin, o));
    db.tx(() => inventory.consume(admin, o));
    expect(inventory.stock()[0]).toMatchObject({
      physical: 400,
      reserved: 0,
      available: 400,
    });
    o.status = "preparing";
    db.tx(() =>
      inventory.cancel(
        admin,
        o,
        [{ itemId: o.items[0]!.id, quantity: 1 }],
        "Desperdício",
      ),
    );
    expect(inventory.stock()[0]).toMatchObject({ physical: 400, reserved: 0 });
    expect(inventory.movements({}).items.filter((m) => m.kind === "waste")).toMatchObject(
      [{ quantity: 0, wasteQuantity: 200 }],
    );
    expect(recipes.get(1)).toHaveLength(2);
  });
  it("bloqueia saldo insuficiente, permite exceção justificada apenas ao administrador e deduplica reservas", () => {
    const meat = ingredient(200);
    recipes.save(admin, 1, {
      active: true,
      items: [{ ingredientId: meat.id, quantity: 200 }],
    });
    const first = order(1);
    db.tx(() => inventory.reserve(waiter, first));
    db.tx(() => inventory.reserve(waiter, first));
    const second = {
      ...first,
      id: randomUUID(),
      items: [{ ...first.items[0]!, id: randomUUID() }],
    };
    db.run(
      "INSERT INTO service_orders(id,request_id,session_id,user_id,created_at,notes,status) VALUES(?,?,?,?,?,'','received')",
      second.id,
      randomUUID(),
      first.sessionId,
      waiter.id,
      new Date().toISOString(),
    );
    db.run(
      "INSERT INTO order_items(id,order_id,product_id,name,quantity,price_cents) VALUES(?,?,1,'Prato',1,2800)",
      second.items[0]!.id,
      second.id,
    );
    expect(() => db.tx(() => inventory.reserve(waiter, second))).toThrow();
    expect(() => db.tx(() => inventory.reserve(waiter, second, "Autorizado"))).toThrow();
    db.tx(() =>
      inventory.reserve(admin, second, "Cliente prioritário, reposição imediata"),
    );
    expect(inventory.stock()[0]).toMatchObject({
      physical: 200,
      reserved: 400,
      available: -200,
    });
    db.tx(() => inventory.consume(admin, first));
    db.tx(() => inventory.consume(admin, second));
    expect(inventory.stock()[0]).toMatchObject({
      physical: -200,
      reserved: 0,
      available: -200,
    });
  });
  it("honra a autorização de déficit independentemente da ordem de preparo", () => {
    const meat = ingredient(200);
    recipes.save(admin, 1, {
      active: true,
      items: [{ ingredientId: meat.id, quantity: 200 }],
    });
    const first = order(1);
    db.tx(() => inventory.reserve(waiter, first));
    const second = {
      ...first,
      id: randomUUID(),
      items: [{ ...first.items[0]!, id: randomUUID() }],
    };
    db.run(
      "INSERT INTO service_orders(id,request_id,session_id,user_id,created_at,notes,status) VALUES(?,?,?,?,?,'','received')",
      second.id,
      randomUUID(),
      first.sessionId,
      waiter.id,
      db.timestamp(),
    );
    db.run(
      "INSERT INTO order_items(id,order_id,product_id,name,quantity,price_cents) VALUES(?,?,1,'Prato',1,2800)",
      second.items[0]!.id,
      second.id,
    );
    db.tx(() =>
      inventory.reserve(admin, second, "Reposição autorizada pelo administrador"),
    );
    db.tx(() => inventory.consume(admin, second));
    db.tx(() => inventory.consume(admin, first));
    expect(inventory.stock()[0]).toMatchObject({ physical: -200, reserved: 0 });
  });
  it("deduplica ajustes e exige justificativa de déficit quando reduz saldo reservado", () => {
    const meat = ingredient();
    const input = {
      requestId: randomUUID(),
      ingredientId: meat.id,
      quantity: 100,
      kind: "adjustment" as const,
      reason: "Conferência",
    };
    inventory.adjust(admin, input);
    inventory.adjust(admin, input);
    expect(inventory.stock()[0]!.physical).toBe(1100);
    expect(() =>
      inventory.adjust(waiter, { ...input, requestId: randomUUID() }),
    ).toThrow();
    recipes.save(admin, 1, {
      active: true,
      items: [{ ingredientId: meat.id, quantity: 200 }],
    });
    const o = order(4);
    db.tx(() => inventory.reserve(waiter, o));
    expect(() =>
      inventory.adjust(admin, { ...input, requestId: randomUUID(), quantity: -400 }),
    ).toThrow();
    inventory.adjust(admin, {
      ...input,
      requestId: randomUUID(),
      quantity: -400,
      overrideReason: "Contagem física confirmada com reposição pendente",
    });
    expect(inventory.stock()[0]).toMatchObject({
      physical: 700,
      reserved: 800,
      available: -100,
    });
  });
  it("não controla produtos antigos sem receita e rejeita receita com ingrediente inativo", () => {
    const o = order(1);
    db.tx(() => inventory.reserve(waiter, o));
    expect(inventory.stock()).toEqual([]);
    const meat = ingredient();
    recipes.save(admin, 1, {
      active: true,
      items: [{ ingredientId: meat.id, quantity: 200 }],
    });
    db.tx(() => inventory.reserve(waiter, o));
    expect(inventory.stock()[0]!.reserved).toBe(0);
    inventory.saveIngredient(
      admin,
      { name: "Carne", unit: "g", minimum: 100, active: false },
      meat.id,
    );
    expect(() =>
      recipes.save(admin, 1, {
        active: true,
        items: [{ ingredientId: meat.id, quantity: 200 }],
      }),
    ).toThrow();
  });
  it("inicia a janela estatística na primeira receita ativa e mantém a data nas edições", () => {
    db.setClock(() => "2026-01-01T12:00:00.000Z");
    const meat = ingredient();
    db.setClock(() => "2026-01-10T12:00:00.000Z");
    recipes.save(admin, 1, {
      active: true,
      items: [{ ingredientId: meat.id, quantity: 200 }],
    });
    expect(inventory.ingredient(meat.id).trackingSince).toBe("2026-01-10T12:00:00.000Z");
    db.setClock(() => "2026-01-12T12:00:00.000Z");
    recipes.save(admin, 1, {
      active: true,
      items: [{ ingredientId: meat.id, quantity: 300 }],
    });
    expect(inventory.ingredient(meat.id).trackingSince).toBe("2026-01-10T12:00:00.000Z");
  });
});

describe("compras e recebimentos", () => {
  it("prepara fichas e saldos demonstrativos sem reabastecer em cada inicialização", () => {
    seedSimulationInventory(db);
    const first = inventory.stock();
    expect(first.length).toBeGreaterThan(5);
    expect(recipes.current(1)?.active).toBe(true);
    expect(inventory.availability(1).available).toBe(true);
    const item = first[0]!;
    inventory.adjust(admin, {
      requestId: randomUUID(),
      ingredientId: item.id,
      quantity: -1,
      kind: "loss",
      reason: "Perda durante treino",
    });
    seedSimulationInventory(db);
    expect(inventory.ingredient(item.id).physical).toBe(item.physical - 1);
  });
  it("recebe parcialmente e deduplica requisições sem inventar pagamento ao fornecedor", () => {
    const meat = ingredient(0);
    const supplier = purchases.saveSupplier(admin, {
      name: "Fornecedor",
      phone: "",
      email: "",
      active: true,
      ingredientIds: [meat.id],
    });
    const purchase = purchases.savePurchase(admin, {
      requestId: randomUUID(),
      supplierId: supplier.id,
      notes: "",
      items: [{ ingredientId: meat.id, quantity: 10, totalCents: 101 }],
    });
    expect(inventory.stock()[0]!.physical).toBe(0);
    purchases.confirm(admin, purchase.id, randomUUID());
    const receipt = {
      requestId: randomUUID(),
      items: [{ itemId: purchase.items[0]!.id, quantity: 6 }],
    };
    const received = purchases.receive(admin, purchase.id, receipt).value;
    purchases.receive(admin, purchase.id, receipt);
    expect(received.status).toBe("partially_received");
    expect(received.items[0]).toMatchObject({ receivedQuantity: 6, receivedCents: 60 });
    expect(inventory.stock()[0]!.physical).toBe(6);
    expect(() =>
      purchases.receive(admin, purchase.id, {
        requestId: randomUUID(),
        items: [{ itemId: purchase.items[0]!.id, quantity: 5 }],
      }),
    ).toThrow();
    const finished = purchases.receive(admin, purchase.id, {
      requestId: randomUUID(),
      items: [{ itemId: purchase.items[0]!.id, quantity: 4 }],
    }).value;
    expect(finished).toMatchObject({ status: "received", receivedCents: 101 });
    expect(inventory.stock()[0]!.physical).toBe(10);
  });
  it("cancela somente saldo não recebido e preserva o histórico", () => {
    const meat = ingredient(0);
    const supplier = purchases.saveSupplier(admin, {
      name: "Fornecedor",
      phone: "",
      email: "",
      active: true,
      ingredientIds: [meat.id],
    });
    const p = purchases.savePurchase(admin, {
      requestId: randomUUID(),
      supplierId: supplier.id,
      notes: "",
      items: [{ ingredientId: meat.id, quantity: 10, totalCents: 1000 }],
    });
    purchases.confirm(admin, p.id, randomUUID());
    purchases.receive(admin, p.id, {
      requestId: randomUUID(),
      items: [{ itemId: p.items[0]!.id, quantity: 6 }],
    });
    const cancelled = purchases.cancel(
      admin,
      p.id,
      randomUUID(),
      "Restante indisponível",
    ).value;
    expect(cancelled).toMatchObject({ status: "cancelled", receivedCents: 600 });
    expect(cancelled.receipts).toHaveLength(1);
    expect(inventory.stock()[0]!.physical).toBe(6);
    expect(() =>
      purchases.receive(admin, p.id, {
        requestId: randomUUID(),
        items: [{ itemId: p.items[0]!.id, quantity: 1 }],
      }),
    ).toThrow();
  });
});
