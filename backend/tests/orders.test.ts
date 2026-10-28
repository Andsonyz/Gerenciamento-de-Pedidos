import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import type { Order } from "@restaurante/shared";
import { createApplication } from "../src/app.js";

describe("pedidos persistidos e entrega local", () => {
  let directory: string;
  let server: ReturnType<typeof createApplication>;
  let base: string;
  const clients: Socket[] = [];
  const payload = () => ({
    requestId: randomUUID(),
    tableId: 1,
    items: [{ productId: 1, quantity: 2 }],
    notes: "Sem cebola",
  });
  const post = (body: unknown) =>
    fetch(`${base}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  async function start() {
    server = createApplication({ dbPath: join(directory, "orders.sqlite") });
    await new Promise<void>((resolve) =>
      server.http.listen(0, "127.0.0.1", resolve),
    );
    const address = server.http.address();
    if (!address || typeof address === "string")
      throw new Error("Porta ausente");
    base = `http://127.0.0.1:${address.port}`;
  }
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "restaurante-"));
    await start();
  });
  afterEach(async () => {
    clients.splice(0).forEach((client) => client.disconnect());
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("registra com número, UUID, horário e produtos do banco", async () => {
    const response = await post(payload());
    expect(response.status).toBe(201);
    const order = (await response.json()) as Order;
    expect(order).toMatchObject({
      number: 1,
      tableId: 1,
      notes: "Sem cebola",
      status: "pending",
      items: [{ name: "Hambúrguer da casa", quantity: 2, priceCents: 2800 }],
    });
    expect(order.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(Number.isNaN(Date.parse(order.createdAt))).toBe(false);
    expect(
      await (await fetch(`${base}/api/orders/${order.id}`)).json(),
    ).toEqual(order);
    expect((await (await fetch(`${base}/api/tables`)).json()).length).toBe(12);
    expect(
      (await (await fetch(`${base}/api/products`)).json()).length,
    ).toBeGreaterThan(3);
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
  ])("rejeita entrada inválida: %j", async (change) => {
    expect((await post({ ...payload(), ...change })).status).toBe(400);
    expect(await (await fetch(`${base}/api/orders`)).json()).toEqual([]);
  });
  it("rejeita JSON malformado sem expor detalhes internos", async () => {
    const response = await fetch(`${base}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "JSON inválido." });
  });
  it("deduplica reenvios simultâneos e rejeita alteração da mesma chave", async () => {
    const body = payload();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => post(body)),
    );
    expect(results.filter((result) => result.status === 201)).toHaveLength(1);
    expect(results.filter((result) => result.status === 200)).toHaveLength(9);
    const orders = await Promise.all(
      results.map((result) => result.json() as Promise<Order>),
    );
    expect(new Set(orders.map((order) => order.id)).size).toBe(1);
    expect((await post({ ...body, notes: "Outro pedido" })).status).toBe(409);
    expect(await (await fetch(`${base}/api/orders`)).json()).toHaveLength(1);
  });
  it("persiste 20 pedidos simultâneos sem perder ou repetir números", async () => {
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => post(payload())),
    );
    expect(responses.every((response) => response.status === 201)).toBe(true);
    const orders = (await (
      await fetch(`${base}/api/orders`)
    ).json()) as Order[];
    expect(orders).toHaveLength(20);
    expect(new Set(orders.map((order) => order.number)).size).toBe(20);
  });
  it("recupera pedidos, estado visualizado e idempotência após reiniciar", async () => {
    const body = payload();
    const order = (await (await post(body)).json()) as Order;
    const marked = await fetch(`${base}/api/orders/${order.id}/viewed`, {
      method: "PATCH",
    });
    expect(marked.status).toBe(200);
    await server.close();
    await start();
    const stored = (await (
      await fetch(`${base}/api/orders`)
    ).json()) as Order[];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: order.id, status: "viewed" });
    expect((await post(body)).status).toBe(200);
    const next = (await (await post(payload())).json()) as Order;
    expect(next.number).toBe(2);
  });
  it("entrega ao vivo e recupera pedidos criados desconectado ou com página fechada", async () => {
    const socket = io(base, { autoConnect: false, reconnectionDelay: 50 });
    clients.push(socket);
    const snapshot = () =>
      new Promise<Order[]>((resolve) =>
        socket.once("orders:snapshot", resolve),
      );
    const first = snapshot();
    socket.connect();
    expect(await first).toEqual([]);
    const event = new Promise<Order>((resolve) =>
      socket.once("order:upsert", resolve),
    );
    const live = (await (await post(payload())).json()) as Order;
    expect((await event).id).toBe(live.id);
    socket.disconnect();
    await post(payload());
    await post(payload());
    const recovered = snapshot();
    socket.connect();
    expect(await recovered).toHaveLength(3);
    const repeated = snapshot();
    socket.emit("orders:sync");
    expect(new Set((await repeated).map((order) => order.id)).size).toBe(3);
    // Force a transport failure: Socket.IO must reconnect automatically.
    const automatic = snapshot();
    socket.io.engine.close();
    expect(await automatic).toHaveLength(3);
    const update = new Promise<Order>((resolve) =>
      socket.once("order:upsert", resolve),
    );
    await fetch(`${base}/api/orders/${live.id}/viewed`, { method: "PATCH" });
    expect((await update).status).toBe("viewed");
  });
  it("limita CORS a origens locais e responde recurso ausente", async () => {
    const local = await fetch(`${base}/api/products`, {
      headers: { Origin: "http://192.168.1.20:5173" },
    });
    expect(local.headers.get("access-control-allow-origin")).toBe(
      "http://192.168.1.20:5173",
    );
    const external = await fetch(`${base}/api/products`, {
      headers: { Origin: "https://example.com" },
    });
    expect(external.status).toBe(403);
    expect((await fetch(`${base}/api/orders/${randomUUID()}`)).status).toBe(
      404,
    );
  });
});
