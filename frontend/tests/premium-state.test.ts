import { afterEach, describe, expect, it, vi } from "vitest";
import { api, parseCents, setCsrfToken } from "../src/api";
import {
  getOperation,
  readOperations,
  saveOperation,
  completeOperation,
  type OperationStorage,
} from "../src/operations";
function storage(): OperationStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}
describe("valores monetários exatos", () => {
  it.each([
    ["0", 0],
    ["0,01", 1],
    ["10,10", 1010],
    ["12.3", 1230],
    ["123456,78", 12345678],
  ])("converte %s para centavos inteiros", (input, cents) => {
    expect(parseCents(input)).toBe(cents);
  });
  it.each(["-1", "1e3", "1,234", "1.000,00", "", "Infinity", "1 00", "9007199254740992"])(
    "recusa entrada ambígua ou fora do limite: %s",
    (input) => {
      expect(() => parseCents(input)).toThrow();
    },
  );
});
describe("diário de operações críticas", () => {
  it("preserva UUID e conteúdo original ao tentar novamente após recarregar", () => {
    const local = storage();
    const original = getOperation(
      "alice",
      "payment:s1",
      "/sessions/s1/payments",
      "POST",
      { amountCents: 1000, method: "cash" },
      local,
    );
    saveOperation("alice", original, local);
    const retry = getOperation(
      "alice",
      "payment:s1",
      "/sessions/s1/payments",
      "POST",
      { amountCents: 2000, method: "pix" },
      local,
    );
    expect(retry).toEqual(original);
    expect(retry.body.amountCents).toBe(1000);
    expect(retry.body.requestId).toMatch(/^[a-f0-9-]{36}$/);
  });
  it("isola as operações por usuário", () => {
    const local = storage();
    const operation = getOperation(
      "alice",
      "order:1",
      "/orders",
      "POST",
      { tableId: 1 },
      local,
    );
    saveOperation("alice", operation, local);
    expect(readOperations("bob", local)).toEqual([]);
    expect(
      getOperation("bob", "order:1", "/orders", "POST", { tableId: 1 }, local).body
        .requestId,
    ).not.toBe(operation.body.requestId);
  });
  it("gera nova intenção somente depois de concluir a anterior", () => {
    const local = storage();
    const original = getOperation(
      "alice",
      "order:1",
      "/orders",
      "POST",
      { tableId: 1 },
      local,
    );
    saveOperation("alice", original, local);
    completeOperation("alice", original, local);
    expect(
      getOperation("alice", "order:1", "/orders", "POST", { tableId: 1 }, local).body
        .requestId,
    ).not.toBe(original.body.requestId);
  });
  it("bloqueia dados corrompidos sem apagar um envio incerto", () => {
    const local = storage();
    local.setItem("mesa.operation.v3.alice.one", "{invalid");
    expect(() => readOperations("alice", local)).toThrow(/operações/i);
    expect(local.getItem("mesa.operation.v3.alice.one")).toBe("{invalid");
  });
  it("preserva intenções independentes e conclusão entre duas abas intercaladas", () => {
    const local = storage();
    const first = getOperation(
      "alice",
      "order:1",
      "/orders",
      "POST",
      { tableId: 1 },
      local,
      "tab-a",
    );
    const second = getOperation(
      "alice",
      "order:1",
      "/orders",
      "POST",
      { tableId: 1 },
      local,
      "tab-b",
    );
    saveOperation("alice", first, local);
    saveOperation("alice", second, local);
    expect(readOperations("alice", local)).toHaveLength(2);
    expect(first.body.requestId).not.toBe(second.body.requestId);
    completeOperation("alice", first, local);
    expect(readOperations("alice", local)).toEqual([second]);
  });
});
describe("transporte autenticado", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setCsrfToken("");
  });
  it("envia cookie e CSRF sem token em armazenamento persistente", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    setCsrfToken("csrf-in-memory");
    await api("/orders", { method: "POST", body: "{}" });
    expect(fetch).toHaveBeenCalledWith(
      "/api/orders",
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({ "X-CSRF-Token": "csrf-in-memory" }),
      }),
    );
  });
  it("preserva a mensagem de conflito do servidor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "A conta já foi encerrada." }), {
          status: 409,
        }),
      ),
    );
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    await expect(api("/orders", { method: "POST", body: "{}" })).rejects.toMatchObject({
      status: 409,
      message: "A conta já foi encerrada.",
    });
  });
});
