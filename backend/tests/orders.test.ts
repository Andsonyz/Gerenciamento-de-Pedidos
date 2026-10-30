import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { createApplication } from "../src/app.js";
import { OrderDatabase } from "../src/database.js";
import type { StateChange } from "@restaurante/shared";
import { privateAddress } from "../src/network.js";

const password = "Test-only-password-123!";
type App = ReturnType<typeof createApplication>;
async function client(app: App, username = "admin") {
  if (!app.http.listening)
    await new Promise<void>((resolve) => app.http.listen(0, "127.0.0.1", resolve));
  const agent = request.agent(app.http);
  const login = await agent.post("/api/auth/login").send({ username, password });
  expect(login.status).toBe(200);
  const csrf = login.body.csrfToken as string;
  const cookie = (login.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
  return {
    agent,
    csrf,
    cookie,
    user: login.body.user,
    get: (path: string) => agent.get("/api" + path),
    post: (path: string, body: unknown = {}) =>
      agent
        .post("/api" + path)
        .set("X-CSRF-Token", csrf)
        .send(body),
    patch: (path: string, body: unknown) =>
      agent
        .patch("/api" + path)
        .set("X-CSRF-Token", csrf)
        .send(body),
  };
}
type Client = Awaited<ReturnType<typeof client>>;
let activeSession = "";
const payload = () => ({
  requestId: randomUUID(),
  tableId: 1,
  sessionId: activeSession,
  items: [{ productId: 1, quantity: 3 }],
  notes: "Sem cebola",
});
describe("operações integradas, persistência, permissões e recuperação", () => {
  let directory: string,
    server: App,
    admin: Client,
    waiter: Client,
    kitchen: Client,
    cashier: Client,
    sessionId: string;
  const sockets: Socket[] = [];
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "restaurant-premium-"));
    server = createApplication({
      dbPath: join(directory, "test.sqlite"),
      bootstrapAdmin: { username: "admin", name: "Admin", password },
    });
    admin = await client(server);
    for (const role of ["waiter", "kitchen", "cashier"] as const)
      expect(
        (
          await admin.post("/users", {
            username: role,
            name: role,
            role,
            password,
            active: true,
          })
        ).status,
      ).toBe(201);
    waiter = await client(server, "waiter");
    kitchen = await client(server, "kitchen");
    cashier = await client(server, "cashier");
    sessionId = (await waiter.post("/tables/1/open", { requestId: randomUUID() })).body
      .id;
    activeSession = sessionId;
  });
  afterEach(async () => {
    sockets.splice(0).forEach((s) => s.disconnect());
    await server.close();
    expect(resolve(directory).startsWith(resolve(tmpdir()) + "\\")).toBe(true);
    await rm(directory, { recursive: true, force: true });
  });
  it("registra pedido real, preserva preço e mostra comanda sem preços", async () => {
    const input = payload(),
      order = await waiter.post("/orders", input);
    expect(order.status).toBe(201);
    expect(order.body).toMatchObject({
      number: 1,
      sessionId,
      status: "received",
      notes: "Sem cebola",
    });
    expect(order.body.items[0]).toMatchObject({
      quantity: 3,
      cancelledQuantity: 0,
      priceCents: 2800,
    });
    expect((await admin.get("/orders")).body).toHaveLength(1);
    const job = (await kitchen.get("/print-jobs")).body[0];
    expect(job).toMatchObject({
      orderId: order.body.id,
      type: "order",
      status: "pending",
      items: [{ name: "Hambúrguer da casa", quantity: 3 }],
    });
    expect(JSON.stringify(job)).not.toMatch(/price|Cents|payment|userId/);
    expect(
      (
        await admin.patch("/products/1", {
          name: "Novo nome",
          category: "Pratos",
          priceCents: 9999,
          available: true,
          active: true,
        })
      ).status,
    ).toBe(200);
    expect((await admin.get(`/sessions/${sessionId}`)).body.totalCents).toBe(8400);
    expect((await waiter.get("/orders")).body[0].items[0].name).toBe(
      "Hambúrguer da casa",
    );
  });
  it.each([
    { tableId: 999 },
    { tableId: 0 },
    { items: [] },
    { items: [{ productId: 999, quantity: 1 }] },
    { items: [{ productId: 1, quantity: 0 }] },
    { items: [{ productId: 1, quantity: 1.5 }] },
    { items: [{ productId: 1, quantity: 100 }] },
    {
      items: [
        { productId: 1, quantity: 1 },
        { productId: 1, quantity: 2 },
      ],
    },
    { notes: "x".repeat(501) },
    { requestId: "invalid" },
    { unexpected: true },
  ])("rejeita pedido inválido e não cria fila: %j", async (change) => {
    expect((await waiter.post("/orders", { ...payload(), ...change })).status).toBe(400);
    expect((await admin.get("/orders")).body).toEqual([]);
    expect((await kitchen.get("/print-jobs")).body).toEqual([]);
  });
  it("deduplica pedidos concorrentes, detecta conflito e aceita dois garçons", async () => {
    const input = payload();
    const repeated = await Promise.all(
      Array.from({ length: 10 }, () => waiter.post("/orders", input)),
    );
    expect(repeated.filter((r) => r.status === 201)).toHaveLength(1);
    expect(repeated.filter((r) => r.status === 200)).toHaveLength(9);
    expect(new Set(repeated.map((r) => r.body.id)).size).toBe(1);
    expect((await waiter.post("/orders", { ...input, notes: "Diferente" })).status).toBe(
      409,
    );
    await admin.post("/users", {
      username: "waiter2",
      name: "Garçom 2",
      role: "waiter",
      password,
      active: true,
    });
    const waiter2 = await client(server, "waiter2");
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        (i % 2 ? waiter : waiter2).post("/orders", payload()),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.number)).size).toBe(20);
    expect((await admin.get("/orders")).body).toHaveLength(21);
    expect((await kitchen.get("/print-jobs")).body).toHaveLength(21);
    expect((await waiter2.get("/orders")).body).toHaveLength(10);
    expect((await waiter2.get("/orders/" + repeated[0]!.body.id)).status).toBe(403);
  });
  it("aprova cancelamento parcial, mantém original, avisa cozinha e evita repetição", async () => {
    const order = (await waiter.post("/orders", payload())).body;
    const input = {
      requestId: randomUUID(),
      reason: "Cliente pediu redução",
      items: [{ itemId: order.items[0].id, quantity: 1 }],
    };
    const requested = await waiter.post(
      `/orders/${order.id}/cancellation-requests`,
      input,
    );
    expect(requested.status).toBe(201);
    expect((await admin.get("/cancellation-requests")).body[0].status).toBe("pending");
    expect(
      (
        await cashier.post(`/sessions/${sessionId}/payments`, {
          requestId: randomUUID(),
          method: "pix",
          amountCents: 100,
        })
      ).status,
    ).toBe(409);
    expect(
      (await admin.patch(`/orders/${order.id}/status`, { status: "preparing" })).status,
    ).toBe(200);
    expect(
      (
        await admin.post(`/cancellation-requests/${requested.body.id}/resolve`, {
          approve: true,
          reason: "Autorizado",
        })
      ).status,
    ).toBe(409);
    const resolution = { approve: true, reason: "Autorizado", acknowledged: true };
    expect(
      (
        await admin.post(
          `/cancellation-requests/${requested.body.id}/resolve`,
          resolution,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await admin.post(
          `/cancellation-requests/${requested.body.id}/resolve`,
          resolution,
        )
      ).status,
    ).toBe(200);
    const bill = (await admin.get("/sessions/" + sessionId)).body;
    expect(bill.totalCents).toBe(5600);
    expect(bill.orders[0].items[0]).toMatchObject({ quantity: 3, cancelledQuantity: 1 });
    const jobs = (await kitchen.get("/print-jobs")).body;
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({ type: "cancellation", items: [{ quantity: 1 }] });
    expect(
      (
        await admin.post(`/orders/${order.id}/cancel`, {
          ...input,
          requestId: randomUUID(),
          acknowledged: true,
          items: [{ itemId: order.items[0].id, quantity: 3 }],
        })
      ).status,
    ).toBe(409);
    expect(
      (await admin.get("/audit")).body.some(
        (a: { action: string }) => a.action === "order.cancelled",
      ),
    ).toBe(true);
  });
  it("rejeição preserva consumo e cancelamento total preserva histórico", async () => {
    const order = (await waiter.post("/orders", payload())).body;
    const input = {
      requestId: randomUUID(),
      reason: "Solicitação cliente",
      items: [{ itemId: order.items[0].id, quantity: 3 }],
    };
    const c = (await waiter.post(`/orders/${order.id}/cancellation-requests`, input))
      .body;
    expect(
      (
        await cashier.post(`/cancellation-requests/${c.id}/resolve`, {
          approve: false,
          reason: "Preparação confirmada",
        })
      ).status,
    ).toBe(200);
    expect((await admin.get("/sessions/" + sessionId)).body.totalCents).toBe(8400);
    const cancel = { ...input, requestId: randomUUID() };
    expect((await admin.post(`/orders/${order.id}/cancel`, cancel)).status).toBe(200);
    expect((await admin.post(`/orders/${order.id}/cancel`, cancel)).status).toBe(200);
    const bill = (await admin.get("/sessions/" + sessionId)).body;
    expect(bill.totalCents).toBe(0);
    expect(bill.orders[0].status).toBe("cancelled");
    expect((await kitchen.get("/print-jobs")).body).toHaveLength(2);
  });
  it("cancela cópias de produção pendentes, preservando cópias dos avisos", async () => {
    const order = (await waiter.post("/orders", payload())).body;
    const original = (await kitchen.get("/print-jobs")).body[0];
    const copy = (
      await kitchen.post(`/print-jobs/${original.id}/reprint`, {
        requestId: randomUUID(),
        reason: "Segunda via solicitada",
      })
    ).body;
    const nested = (
      await kitchen.post(`/print-jobs/${copy.id}/reprint`, {
        requestId: randomUUID(),
        reason: "Outra conferência",
      })
    ).body;
    await admin.post(`/orders/${order.id}/cancel`, {
      requestId: randomUUID(),
      reason: "Cancelamento total",
      items: [{ itemId: order.items[0].id, quantity: 3 }],
    });
    const jobs = (await kitchen.get("/print-jobs")).body;
    for (const id of [original.id, copy.id, nested.id]) {
      expect(jobs.find((j: { id: string }) => j.id === id).status).toBe("cancelled");
      expect(
        (await kitchen.patch(`/print-jobs/${id}`, { status: "displayed" })).status,
      ).toBe(409);
      expect(
        (
          await kitchen.post(`/print-jobs/${id}/reprint`, {
            requestId: randomUUID(),
            reason: "Nova tentativa",
          })
        ).status,
      ).toBe(409);
    }
    const warning = jobs.find((j: { type: string }) => j.type === "cancellation");
    expect(
      (
        await kitchen.post(`/print-jobs/${warning.id}/reprint`, {
          requestId: randomUUID(),
          reason: "Aviso precisa de cópia",
        })
      ).body,
    ).toMatchObject({ status: "pending", type: "reprint" });
  });
  it("conta, descontos, pagamentos parciais/múltiplos e troco; bloqueia cancelamento pago", async () => {
    const order = (await waiter.post("/orders", payload())).body;
    expect(
      (
        await admin.patch(`/sessions/${sessionId}/adjustments`, {
          discountCents: 400,
          serviceCents: 500,
          reason: "Cortesia autorizada",
        })
      ).body.totalCents,
    ).toBe(8500);
    expect((await waiter.post(`/sessions/${sessionId}/request-close`)).body).toEqual({
      id: sessionId,
      tableId: 1,
      status: "awaiting_payment",
    });
    const input = {
      requestId: randomUUID(),
      method: "cash",
      amountCents: 2000,
      tenderedCents: 5000,
    };
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        cashier.post(`/sessions/${sessionId}/payments`, input),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    let bill = (await admin.get("/sessions/" + sessionId)).body;
    expect(bill.payments).toHaveLength(1);
    expect(bill.balanceCents).toBe(6500);
    expect(bill.payments[0].changeCents).toBe(3000);
    expect(
      (
        await admin.post(`/orders/${order.id}/cancel`, {
          requestId: randomUUID(),
          reason: "Após pagamento",
          items: [{ itemId: order.items[0].id, quantity: 1 }],
        })
      ).status,
    ).toBe(409);
    expect(
      (await cashier.post(`/sessions/${sessionId}/close`, { requestId: randomUUID() }))
        .status,
    ).toBe(409);
    expect(
      (
        await cashier.post(`/sessions/${sessionId}/payments`, {
          requestId: randomUUID(),
          method: "pix",
          amountCents: 6501,
        })
      ).status,
    ).toBe(409);
    bill = (
      await cashier.post(`/sessions/${sessionId}/payments`, {
        requestId: randomUUID(),
        method: "pix",
        amountCents: 6500,
      })
    ).body;
    expect(bill.balanceCents).toBe(0);
    expect(bill.payments).toHaveLength(2);
    expect(
      (await cashier.post(`/sessions/${sessionId}/close`, { requestId: randomUUID() }))
        .body.status,
    ).toBe("closed");
    expect((await waiter.get("/tables")).body[0]).toMatchObject({
      status: "available",
      sessionId: null,
    });
    expect((await waiter.post("/orders", payload())).status).toBe(409);
  });
  it("estorno manual separado e auditado protege saldo e idempotência", async () => {
    const order = (await waiter.post("/orders", payload())).body;
    const paid = (
      await cashier.post(`/sessions/${sessionId}/payments`, {
        requestId: randomUUID(),
        method: "credit",
        amountCents: 8400,
      })
    ).body;
    const paymentId = paid.payments[0].id,
      input = {
        requestId: randomUUID(),
        amountCents: 8400,
        reason: "Estorno manual confirmado",
      };
    expect((await cashier.post(`/payments/${paymentId}/refund`, input)).status).toBe(403);
    const refunded = await admin.post(`/payments/${paymentId}/refund`, input);
    expect(refunded.body.balanceCents).toBe(8400);
    expect(
      (await admin.post(`/payments/${paymentId}/refund`, input)).body.payments[0]
        .refundedCents,
    ).toBe(8400);
    expect(
      (
        await admin.post(`/payments/${paymentId}/refund`, {
          ...input,
          requestId: randomUUID(),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await admin.post(`/orders/${order.id}/cancel`, {
          requestId: randomUUID(),
          reason: "Cancelado após estorno",
          items: [{ itemId: order.items[0].id, quantity: 3 }],
        })
      ).status,
    ).toBe(200);
    expect((await admin.get("/dashboard")).body.revenueTodayCents).toBe(0);
  });
  it("encerramento excepcional exige administrador, motivo e baixa auditada", async () => {
    await waiter.post("/orders", payload());
    const input = {
      requestId: randomUUID(),
      exceptional: true,
      reason: "Cortesia integral autorizada",
    };
    expect((await cashier.post(`/sessions/${sessionId}/close`, input)).status).toBe(409);
    const closed = await admin.post(`/sessions/${sessionId}/close`, input);
    expect(closed.body).toMatchObject({
      status: "closed",
      waivedCents: 8400,
      balanceCents: 0,
      paidCents: 0,
    });
    expect((await admin.get("/dashboard")).body.revenueTodayCents).toBe(0);
  });
  it("impede rascunho antigo de entrar no atendimento seguinte da mesma mesa", async () => {
    const oldDraft = payload();
    expect(
      (await admin.post(`/sessions/${sessionId}/close`, { requestId: randomUUID() }))
        .status,
    ).toBe(200);
    const opened = await waiter.post("/tables/1/open", { requestId: randomUUID() });
    expect(opened.body.id).not.toBe(sessionId);
    expect((await waiter.post("/orders", oldDraft)).status).toBe(409);
    expect(
      (await waiter.post("/orders", { ...oldDraft, sessionId: opened.body.id })).status,
    ).toBe(201);
  });
  it("recupera sessões, pagamentos, jobs e chaves após reinicialização", async () => {
    const input = payload(),
      order = (await waiter.post("/orders", input)).body;
    await cashier.post(`/sessions/${sessionId}/payments`, {
      requestId: randomUUID(),
      method: "debit",
      amountCents: 1000,
    });
    const job = (await kitchen.get("/print-jobs")).body[0];
    await kitchen.patch("/print-jobs/" + job.id, { status: "failed" });
    await server.close();
    server = createApplication({ dbPath: join(directory, "test.sqlite") });
    admin = await client(server);
    waiter = await client(server, "waiter");
    kitchen = await client(server, "kitchen");
    expect((await waiter.post("/orders", input)).body.id).toBe(order.id);
    expect((await admin.get("/sessions/" + sessionId)).body).toMatchObject({
      paidCents: 1000,
      balanceCents: 7400,
    });
    expect((await kitchen.get("/print-jobs")).body[0]).toMatchObject({
      id: job.id,
      status: "failed",
    });
    expect(
      (await kitchen.patch("/print-jobs/" + job.id, { status: "displayed" })).body.status,
    ).toBe("displayed");
    const reprint = { requestId: randomUUID(), reason: "Conferência da cozinha" };
    const copy = await kitchen.post(`/print-jobs/${job.id}/reprint`, reprint);
    expect(copy.body).toMatchObject({
      type: "reprint",
      sourceJobId: job.id,
      status: "pending",
    });
    expect((await kitchen.post(`/print-jobs/${job.id}/reprint`, reprint)).body.id).toBe(
      copy.body.id,
    );
    expect((await kitchen.get("/print-jobs")).body).toHaveLength(2);
  });
  it("aplica RBAC, CSRF, disponibilidade, transições e bloqueio do último admin", async () => {
    expect((await request(server.app).get("/api/orders")).status).toBe(401);
    for (const path of ["/users", "/audit", "/dashboard", "/sessions", "/print-jobs"])
      expect((await waiter.get(path)).status).toBe(403);
    expect((await kitchen.get("/products")).status).toBe(403);
    expect((await kitchen.get("/orders")).status).toBe(403);
    expect((await waiter.post("/products", {})).status).toBe(403);
    expect((await waiter.post(`/sessions/${sessionId}/payments`, {})).status).toBe(403);
    expect(
      (await admin.agent.post("/api/tables/2/open").send({ requestId: randomUUID() }))
        .status,
    ).toBe(403);
    expect(
      (
        await admin.patch("/users/" + admin.user.id, {
          username: "admin",
          name: "Admin",
          role: "admin",
          active: false,
        })
      ).status,
    ).toBe(409);
    await admin.patch("/products/1", {
      name: "Hambúrguer",
      category: "Pratos",
      priceCents: 2800,
      active: true,
      available: false,
    });
    expect((await waiter.post("/orders", payload())).status).toBe(400);
    expect((await kitchen.get("/print-jobs")).body).toEqual([]);
    await admin.patch("/products/1", {
      name: "Hambúrguer",
      category: "Pratos",
      priceCents: 2800,
      active: true,
      available: true,
    });
    const order = (await waiter.post("/orders", payload())).body;
    expect(
      (await kitchen.patch(`/orders/${order.id}/status`, { status: "ready" })).status,
    ).toBe(409);
    const preparing = await kitchen.patch(`/orders/${order.id}/status`, {
      status: "preparing",
    });
    expect(preparing.body).toEqual({ id: order.id, status: "preparing" });
    await admin.patch("/users/" + waiter.user.id, {
      username: "waiter",
      name: "Waiter",
      role: "waiter",
      active: false,
    });
    expect((await waiter.get("/orders")).status).toBe(401);
  });
  it("socket autenticado avisa desktop/cozinha, reconecta e recupera sem duplicar", async () => {
    const address = server.http.address();
    if (!address || typeof address === "string") throw new Error("Porta ausente");
    const base = `http://127.0.0.1:${address.port}`;
    const connect = (c: Client) => {
      const socket = io(base, {
        autoConnect: false,
        auth: { csrfToken: c.csrf },
        extraHeaders: { Cookie: c.cookie },
        reconnectionDelay: 50,
      });
      sockets.push(socket);
      return socket;
    };
    const ks = connect(kitchen),
      desk = connect(admin);
    const connected = (socket: Socket) =>
      new Promise<void>((resolve) => socket.once("connect", () => resolve()));
    const kfirst = connected(ks),
      dfirst = connected(desk);
    ks.connect();
    desk.connect();
    await Promise.all([kfirst, dfirst]);
    const event = (socket: Socket, scope: string) =>
      new Promise<StateChange>((resolve) => {
        const listener = (e: StateChange) => {
          if (e.scope === scope) {
            socket.off("state:changed", listener);
            resolve(e);
          }
        };
        socket.on("state:changed", listener);
      });
    const printed = event(ks, "printing"),
      created = event(desk, "orders");
    const order = (await waiter.post("/orders", payload())).body;
    expect((await printed).id).toBe(order.id);
    expect((await created).id).toBe(order.id);
    ks.disconnect();
    await waiter.post("/orders", payload());
    await waiter.post("/orders", payload());
    const recovered = connected(ks);
    ks.connect();
    await recovered;
    const jobs = (await kitchen.get("/print-jobs")).body;
    expect(jobs).toHaveLength(3);
    expect(new Set(jobs.map((j: { id: string }) => j.id)).size).toBe(3);
    const reconnected = connected(ks);
    ks.io.engine.close();
    await reconnected;
    expect((await kitchen.get("/print-jobs")).body).toHaveLength(3);
    const unauthorized = io(base, { autoConnect: false, reconnection: false });
    sockets.push(unauthorized);
    const failure = new Promise<string>((resolve) =>
      unauthorized.once("connect_error", (e) => resolve(e.message)),
    );
    unauthorized.connect();
    expect(await failure).toMatch(/Autenticação/);
    const disconnected = new Promise<void>((resolve) =>
      ks.once("disconnect", () => resolve()),
    );
    await admin.patch("/users/" + kitchen.user.id, {
      username: "kitchen",
      name: "Kitchen",
      role: "kitchen",
      active: false,
    });
    await disconnected;
  });
  it("CORS local, JSON inválido, corpo excessivo e SQL injection", async () => {
    expect(
      (await admin.agent.get("/api/products").set("Origin", "http://192.168.1.20:5173"))
        .headers["access-control-allow-origin"],
    ).toBe("http://192.168.1.20:5173");
    expect(
      (await admin.agent.get("/api/products").set("Origin", "https://example.com"))
        .status,
    ).toBe(403);
    const invalid = await admin.agent
      .post("/api/orders")
      .set("Content-Type", "application/json")
      .set("X-CSRF-Token", admin.csrf)
      .send("{");
    expect(invalid.status).toBe(400);
    expect(
      (await admin.post("/orders", { ...payload(), notes: "x".repeat(40000) })).status,
    ).toBe(413);
    expect(
      (
        await request(server.app)
          .post("/api/auth/login")
          .send({ username: "' OR 1=1 --", password })
      ).status,
    ).toBe(401);
    expect(privateAddress("8.8.8.8")).toBe(false);
    expect(privateAddress("8.8.8.8", ["0.0.0.0/0"])).toBe(false);
    expect(privateAddress("192.168.10.2", ["192.168.1.0/24"])).toBe(false);
    expect(privateAddress("192.168.1.2", ["192.168.1.0/24"])).toBe(true);
  });
  it("migra banco anterior sem apagar pedidos nem repetir importação", async () => {
    await server.close();
    const legacyPath = join(directory, "legacy.sqlite");
    const old = new OrderDatabase(legacyPath);
    const original = old.create(payload()).order;
    old.markViewed(original.id);
    old.close();
    server = createApplication({
      dbPath: legacyPath,
      bootstrapAdmin: { username: "admin", name: "Admin", password },
    });
    admin = await client(server);
    expect((await admin.get("/orders")).body[0]).toMatchObject({
      id: original.id,
      number: original.number,
      items: [{ priceCents: 2800, quantity: 3 }],
    });
    expect((await admin.get("/print-jobs")).body[0].status).toBe("displayed");
    expect((await readFile(legacyPath + ".pre-premium.bak")).byteLength).toBeGreaterThan(
      0,
    );
    await server.close();
    server = createApplication({ dbPath: legacyPath });
    admin = await client(server);
    expect((await admin.get("/orders")).body).toHaveLength(1);
    expect((await admin.get("/print-jobs")).body).toHaveLength(1);
  });
});
