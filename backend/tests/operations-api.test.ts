import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createApplication } from "../src/app.js";
const servers: ReturnType<typeof createApplication>[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
});
describe("API integrada de ingredientes", () => {
  it("serializa reservas concorrentes e recusa falta sem autorização", async () => {
    const server = createApplication({
      dbPath: ":memory:",
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
    const post = (url: string, body: object) =>
      agent
        .post("/api" + url)
        .set("X-CSRF-Token", csrf)
        .send(body);
    const ingredient = await post("/ingredients", {
      name: "Ingrediente limitado",
      unit: "g",
      minimum: 0,
      active: true,
    });
    await post("/inventory/adjustments", {
      requestId: randomUUID(),
      ingredientId: ingredient.body.id,
      quantity: 1000,
      kind: "initial",
      reason: "Saldo contado",
    });
    await post("/products/1/recipes", {
      active: true,
      items: [{ ingredientId: ingredient.body.id, quantity: 200 }],
    });
    const session = await post("/tables/1/open", { requestId: randomUUID() });
    const make = () =>
      post("/orders", {
        requestId: randomUUID(),
        tableId: 1,
        sessionId: session.body.id,
        notes: "",
        items: [{ productId: 1, quantity: 3 }],
      });
    const outcomes = await Promise.all([make(), make()]);
    expect(outcomes.map((x) => x.status).sort()).toEqual([201, 409]);
    expect((await agent.get("/api/inventory")).body[0].reserved).toBe(600);
    expect((await agent.get("/api/orders")).body).toHaveLength(1);
  });
  it("reserva, libera e consome usando o fluxo normal de pedidos", async () => {
    const server = createApplication({
      dbPath: ":memory:",
      bootstrapAdmin: {
        username: "admin",
        name: "Administrador",
        password: "Strong-password-123!",
      },
    });
    servers.push(server);
    const agent = request.agent(server.app);
    const login = await agent
      .post("/api/auth/login")
      .send({ username: "admin", password: "Strong-password-123!" });
    const csrf = login.body.csrfToken as string;
    const post = (url: string, body: object) =>
      agent
        .post("/api" + url)
        .set("X-CSRF-Token", csrf)
        .send(body);
    const ingredient = await post("/ingredients", {
      name: "Carne",
      unit: "g",
      minimum: 100,
      active: true,
    });
    expect(ingredient.status).toBe(201);
    expect(
      (
        await post("/inventory/adjustments", {
          requestId: randomUUID(),
          ingredientId: ingredient.body.id,
          quantity: 1000,
          kind: "initial",
          reason: "Contagem inicial",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await post("/products/1/recipes", {
          active: true,
          items: [{ ingredientId: ingredient.body.id, quantity: 200 }],
        })
      ).status,
    ).toBe(201);
    const opened = await post("/tables/1/open", { requestId: randomUUID() });
    const payload = {
      requestId: randomUUID(),
      tableId: 1,
      sessionId: opened.body.id,
      notes: "",
      items: [{ productId: 1, quantity: 4 }],
    };
    const order = await post("/orders", payload);
    expect(order.status).toBe(201);
    expect((await agent.get("/api/inventory")).body[0]).toMatchObject({
      physical: 1000,
      reserved: 800,
      available: 200,
    });
    expect(
      (
        await post(`/orders/${order.body.id}/cancel`, {
          requestId: randomUUID(),
          reason: "Cliente pediu menos",
          items: [{ itemId: order.body.items[0].id, quantity: 1 }],
        })
      ).status,
    ).toBe(200);
    expect((await agent.get("/api/inventory")).body[0].reserved).toBe(600);
    expect(
      (
        await agent
          .patch(`/api/orders/${order.body.id}/status`)
          .set("X-CSRF-Token", csrf)
          .send({ status: "preparing" })
      ).status,
    ).toBe(200);
    expect((await agent.get("/api/inventory")).body[0]).toMatchObject({
      physical: 400,
      reserved: 0,
      available: 400,
    });
  });
});
