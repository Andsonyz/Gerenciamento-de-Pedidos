import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Store } from "../src/database/store.js";
import { seedSimulation } from "../src/modules/simulation-seed.js";
import { Inventory } from "../src/modules/inventory.js";
import { TrainingResources } from "../src/modules/training-resources.js";
import { Purchasing } from "../src/modules/purchasing.js";
const stores: Store[] = [];
afterEach(() => {
  for (const db of stores.splice(0)) db.close();
});
function setup() {
  const db = new Store(":memory:");
  stores.push(db);
  const user = seedSimulation(db)[0]!;
  const resources = new TrainingResources(db);
  const ingredient = new Inventory(db).saveIngredient(user, {
    name: "Arroz de apoio",
    unit: "g",
    minimum: 100,
    active: true,
  });
  return { db, user, resources, ingredient };
}
describe("recursos do restaurante simulado", () => {
  it("despesas não podem vincular compra; reversões antigas não reduzem seu pagamento devido", () => {
    const { db, user, resources, ingredient } = setup();
    const purchasing = new Purchasing(db);
    const supplier = purchasing.saveSupplier(user, {
      name: "Fornecedor teste",
      phone: "",
      email: "",
      active: true,
      ingredientIds: [],
    });
    const purchase = purchasing.savePurchase(user, {
      requestId: randomUUID(),
      supplierId: supplier.id,
      notes: "",
      items: [{ ingredientId: ingredient.id, quantity: 100, totalCents: 1000 }],
    });
    purchasing.confirm(user, purchase.id, randomUUID());
    expect(() =>
      resources.entry(user, {
        requestId: randomUUID(),
        kind: "expense",
        purchaseId: purchase.id,
        amountCents: 500,
        reason: "Despesa indevidamente vinculada",
      }),
    ).toThrow();
    db.run(
      "INSERT INTO dashboard_cash_entries VALUES(?,?,?,?,?,?)",
      "legacy-expense",
      "expense",
      -500,
      purchase.id,
      "Despesa anterior",
      db.timestamp(),
    );
    resources.reverseEntry(
      user,
      "legacy-expense",
      randomUUID(),
      "Corrigir despesa anterior",
    );
    expect(() =>
      resources.entry(user, {
        requestId: randomUUID(),
        kind: "purchase_payment",
        purchaseId: purchase.id,
        amountCents: 1500,
        reason: "Pagamento acima do devido",
      }),
    ).toThrow(/saldo/);
    const paid = resources.entry(user, {
      requestId: randomUUID(),
      kind: "purchase_payment",
      purchaseId: purchase.id,
      amountCents: 1000,
      reason: "Pagamento correto",
    });
    resources.reverseEntry(user, paid.id, randomUUID(), "Estornar pagamento da compra");
    resources.entry(user, {
      requestId: randomUUID(),
      kind: "purchase_payment",
      purchaseId: purchase.id,
      amountCents: 1000,
      reason: "Refazer pagamento",
    });
  });
  it("recebe contribuição mista sem transformar bens em dinheiro ou vendas", () => {
    const { db, user, resources, ingredient } = setup();
    const sponsor = resources.saveSponsor(user, { name: "Raízes Alimentos" });
    const input = {
      requestId: randomUUID(),
      sponsorId: sponsor.id,
      cashCents: 5000,
      notes: "Doação para treinamento",
      lines: [
        {
          kind: "ingredient" as const,
          ingredientId: ingredient.id,
          name: "Arroz",
          quantity: 2000,
          valuationCents: 1500,
        },
        { kind: "equipment" as const, name: "Forno", quantity: 1, valuationCents: null },
      ],
    };
    const received = resources.receive(user, input);
    resources.receive(user, input);
    expect(new Inventory(db).ingredient(ingredient.id).physical).toBe(2000);
    expect(resources.state().ledger.reduce((s, r) => s + r.amountCents, 0)).toBe(5000);
    expect(resources.state().equipment).toHaveLength(1);
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM service_orders")!.n).toBe(0);
    resources.reverseContribution(user, received.id, randomUUID(), "Correção do apoio");
    expect(new Inventory(db).ingredient(ingredient.id).physical).toBe(0);
    expect(resources.state().ledger.reduce((s, r) => s + r.amountCents, 0)).toBe(0);
    expect(resources.state().equipment[0]!.active).toBe(false);
  });
  it("recusa receber patrocínio no banco operacional", () => {
    const db = new Store(":memory:");
    stores.push(db);
    expect(() => new TrainingResources(db)).toThrow(/treinamento/);
  });
  it("receber compra não paga; pagamento não pode exceder dívida nem duplicar por retry", () => {
    const { db, user, resources, ingredient } = setup();
    const purchasing = new Purchasing(db);
    const supplier = purchasing.saveSupplier(user, {
      name: "Fornecedor teste",
      phone: "",
      email: "",
      active: true,
      ingredientIds: [],
    });
    const purchase = purchasing.savePurchase(user, {
      requestId: randomUUID(),
      supplierId: supplier.id,
      notes: "",
      items: [{ ingredientId: ingredient.id, quantity: 100, totalCents: 3000 }],
    });
    purchasing.confirm(user, purchase.id, randomUUID());
    purchasing.receive(user, purchase.id, {
      requestId: randomUUID(),
      items: [{ itemId: purchase.items[0]!.id, quantity: 100 }],
    });
    expect(resources.state().ledger).toHaveLength(0);
    const payment = {
      requestId: randomUUID(),
      kind: "purchase_payment" as const,
      purchaseId: purchase.id,
      amountCents: 3000,
      reason: "Pagamento simulado da compra",
    };
    resources.entry(user, payment);
    resources.entry(user, payment);
    expect(resources.state().ledger.reduce((s, r) => s + r.amountCents, 0)).toBe(-3000);
    expect(() =>
      resources.entry(user, { ...payment, requestId: randomUUID(), amountCents: 1 }),
    ).toThrow(/saldo/);
  });
  it("abertura desconhecida continua nula; registrar abertura não importa caixa atual", () => {
    const { resources, user } = setup();
    expect(resources.state().openingBalanceCents).toBeNull();
    resources.setOpeningBalance(user, {
      requestId: randomUUID(),
      amountCents: 10000,
      reason: "Abertura fictícia da rodada",
    });
    resources.entry(user, {
      requestId: randomUUID(),
      kind: "expense",
      amountCents: 2000,
      reason: "Despesa simulada",
    });
    expect(resources.state().openingBalanceCents).toBe(10000);
    expect(resources.state().ledger.reduce((s, r) => s + r.amountCents, 0)).toBe(-2000);
  });
});
