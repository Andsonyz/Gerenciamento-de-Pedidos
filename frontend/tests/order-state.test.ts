import { describe, expect, it } from "vitest";
import type { Order } from "@restaurante/shared";
import { mergeOrder, normalizeOrders } from "../src/order-state";
import { createRequestId } from "../src/submission";
const order: Order = {
  id: "one",
  number: 1,
  requestId: "request",
  tableId: 1,
  createdAt: "2026-10-27T12:00:00Z",
  notes: "",
  status: "pending",
  items: [],
};
describe("estado de comandas", () => {
  it("substitui a mesma comanda em eventos repetidos", () => {
    const orders = mergeOrder([order], { ...order, status: "viewed" });
    expect(orders).toHaveLength(1);
    expect(orders[0]?.status).toBe("viewed");
  });
  it("deduplica snapshots e ordena do mais recente para o mais antigo", () => {
    expect(
      normalizeOrders([order, { ...order, id: "two", number: 2 }, order]).map(
        (value) => value.id,
      ),
    ).toEqual(["two", "one"]);
  });
  it("gera chaves UUID distintas sem depender de randomUUID em HTTP LAN", () => {
    const id = createRequestId();
    expect(id).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    );
    expect(createRequestId()).not.toBe(id);
  });
});
