import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createApplication } from "../src/app.js";
import { Store } from "../src/database/store.js";
import { AuthService } from "../src/modules/auth.js";
import { Restaurant } from "../src/modules/restaurant.js";
import { VirtualPrinterAdapter } from "../src/printing/VirtualPrinterAdapter.js";
import { TableNotifications } from "../src/modules/notifications.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
const servers: ReturnType<typeof createApplication>[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});
async function fixture() {
  const server = createApplication({
    dbPath: ":memory:",
    simulationDbPath: ":memory:",
    bootstrapAdmin: {
      username: "admin",
      name: "Admin",
      password: "Strong-password-123!",
    },
  });
  servers.push(server);
  const agent = request.agent(server.app);
  const login = await agent
    .post("/api/auth/login")
    .send({ username: "admin", password: "Strong-password-123!" });
  const csrf = login.body.csrfToken as string;
  const post = (path: string, body: object = {}) =>
    agent
      .post("/api" + path)
      .set("X-CSRF-Token", csrf)
      .send({ requestId: randomUUID(), ...body });
  return { server, agent, post, csrf };
}
describe("notificações de atendimento", () => {
  it("preserva o chamado e o atendimento após reabrir o arquivo SQLite", () => {
    const directory = mkdtempSync(join(tmpdir(), "restaurant-notifications-"));
    const path = join(directory, "test.sqlite");
    let db: Store | undefined;
    try {
      db = new Store(path);
      const user = new AuthService(db).saveUser(null, {
        username: "admin",
        name: "Admin",
        role: "admin",
        active: true,
        password: "Strong-password-123!",
      });
      new Restaurant(db, new VirtualPrinterAdapter(db)).open(user, 1, randomUUID());
      new TableNotifications(db).acknowledge(user, 1, randomUUID());
      db.close();
      db = new Store(path);
      expect(new TableNotifications(db).list().items[0]!.type).toBe("order");
      new TableNotifications(db).call(user, 1, randomUUID());
      db.close();
      db = new Store(path);
      expect(new TableNotifications(db).list().counts).toEqual({
        waiter: 1,
        order: 0,
        closing: 0,
        total: 1,
      });
    } finally {
      db?.close();
      if (!resolve(directory).startsWith(resolve(tmpdir())))
        throw new Error("Diretório fora do escopo");
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("sinaliza ocupação, atendimento, pedido e fechamento sem duplicar a mesa", async () => {
    const { agent, post, csrf } = await fixture();
    const opened = await post("/tables/1/open");
    let alerts = await agent.get("/api/notifications");
    expect(alerts.status).toBe(200);
    expect(alerts.body.counts).toEqual({ waiter: 1, order: 0, closing: 0, total: 1 });
    expect(alerts.body.items[0]).toMatchObject({ tableId: 1, type: "waiter" });
    expect((await post("/tables/1/acknowledge-call")).status).toBe(200);
    expect((await agent.get("/api/notifications")).body.items[0].type).toBe("order");
    const order = await post("/orders", {
      tableId: 1,
      sessionId: opened.body.id,
      items: [{ productId: 1, quantity: 1 }],
      notes: "",
    });
    expect(order.status).toBe(201);
    const call = { requestId: randomUUID() };
    await post("/tables/1/call-waiter", call);
    await post("/tables/1/call-waiter", call);
    await post("/tables/1/call-waiter");
    alerts = await agent.get("/api/notifications");
    expect(alerts.body.counts).toEqual({ waiter: 1, order: 0, closing: 0, total: 1 });
    await post("/tables/1/acknowledge-call");
    for (const status of ["preparing", "ready", "delivered"])
      expect(
        (
          await agent
            .patch(`/api/orders/${order.body.id}/status`)
            .set("X-CSRF-Token", csrf)
            .send({ status })
        ).status,
      ).toBe(200);
    expect((await agent.get("/api/notifications")).body.counts.total).toBe(0);
    await agent
      .post(`/api/sessions/${opened.body.id}/request-close`)
      .set("X-CSRF-Token", csrf)
      .send({});
    expect((await agent.get("/api/notifications")).body.counts).toEqual({
      waiter: 0,
      order: 0,
      closing: 1,
      total: 1,
    });
    expect((await post("/tables/1/call-waiter")).status).toBe(409);
    await post(`/sessions/${opened.body.id}/close`, {
      exceptional: true,
      reason: "Encerramento autorizado para teste",
    });
    expect((await agent.get("/api/notifications")).body.items).toEqual([]);
  });
  it("nega chamadas em mesas livres, exige autenticação/CSRF e separa treinamento", async () => {
    const { server, agent, post } = await fixture();
    expect((await request(server.app).get("/api/notifications")).status).toBe(401);
    expect(
      (await agent.post("/api/tables/1/call-waiter").send({ requestId: randomUUID() }))
        .status,
    ).toBe(403);
    expect((await post("/tables/1/call-waiter")).status).toBe(409);
    await post("/tables/1/open");
    const training = request.agent(server.app);
    await training
      .post("/simulacao/api/auth/login")
      .send({ username: "admin", password: "123" });
    expect((await training.get("/simulacao/api/notifications")).body.counts.total).toBe(
      0,
    );
    expect((await agent.get("/api/notifications")).body.counts.waiter).toBe(1);
  });
});
