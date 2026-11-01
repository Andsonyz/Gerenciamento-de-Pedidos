import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createApplication } from "../src/app.js";

const servers: ReturnType<typeof createApplication>[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});
describe("premium: autorização e operação de restaurante", () => {
  it("protege a API e calcula a conta no servidor", async () => {
    const server = createApplication({
      dbPath: ":memory:",
      bootstrapAdmin: {
        username: "admin",
        password: "Strong-password-123!",
        name: "Administrador",
      },
    });
    servers.push(server);
    const agent = request.agent(server.app);
    expect((await agent.get("/api/orders")).status).toBe(401);
    const login = await agent
      .post("/api/auth/login")
      .send({ username: "admin", password: "Strong-password-123!" });
    expect(login.status).toBe(200);
    const csrf = login.body.csrfToken as string;
    expect(
      (await agent.post("/api/tables/1/open").send({ requestId: randomUUID() })).status,
    ).toBe(403);
    const opened = await agent
      .post("/api/tables/1/open")
      .set("X-CSRF-Token", csrf)
      .send({ requestId: randomUUID() });
    expect(opened.status).toBe(201);
    const payload = {
      requestId: randomUUID(),
      tableId: 1,
      sessionId: opened.body.id,
      items: [{ productId: 1, quantity: 3 }],
      notes: "Sem cebola",
    };
    const order = await agent.post("/api/orders").set("X-CSRF-Token", csrf).send(payload);
    expect(order.status).toBe(201);
    expect(
      (await agent.post("/api/orders").set("X-CSRF-Token", csrf).send(payload)).body.id,
    ).toBe(order.body.id);
    const cancelled = await agent
      .post(`/api/orders/${order.body.id}/cancel`)
      .set("X-CSRF-Token", csrf)
      .send({
        requestId: randomUUID(),
        reason: "Cliente reduziu quantidade",
        items: [{ itemId: order.body.items[0].id, quantity: 1 }],
      });
    expect(cancelled.status).toBe(200);
    const bill = await agent.get(`/api/sessions/${opened.body.id}`);
    expect(bill.body.totalCents).toBe(5600);
    expect(bill.body.orders[0].items[0]).toMatchObject({
      quantity: 3,
      cancelledQuantity: 1,
    });
    const paid = await agent
      .post(`/api/sessions/${opened.body.id}/payments`)
      .set("X-CSRF-Token", csrf)
      .send({
        requestId: randomUUID(),
        method: "cash",
        amountCents: 2000,
        tenderedCents: 5000,
      });
    expect(paid.status).toBe(201);
    expect(paid.body.balanceCents).toBe(3600);
    expect(paid.body.payments[0].changeCents).toBe(3000);
    expect(
      (
        await agent
          .post(`/api/sessions/${opened.body.id}/close`)
          .set("X-CSRF-Token", csrf)
          .send({ requestId: randomUUID() })
      ).status,
    ).toBe(409);
  });
});
