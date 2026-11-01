import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApplication } from "../src/app.js";
import { mkdtempSync, linkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Store } from "../src/database/store.js";
import { io as connectSocket } from "socket.io-client";
const servers: ReturnType<typeof createApplication>[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
});
function fixture() {
  const server = createApplication({
    dbPath: ":memory:",
    simulationDbPath: ":memory:",
    bootstrapAdmin: {
      username: "admin",
      name: "Administrador",
      password: "Strong-password-123!",
    },
  });
  servers.push(server);
  return server;
}
describe("isolamento real do treinamento", () => {
  it("autentica o namespace da simulação somente com seu próprio cookie e CSRF", async () => {
    const server = fixture();
    await new Promise<void>((resolve) => server.http.listen(0, "127.0.0.1", resolve));
    const address = server.http.address();
    if (!address || typeof address === "string") throw new Error("Porta indisponível");
    const real = await request(server.app)
      .post("/api/auth/login")
      .send({ username: "admin", password: "Strong-password-123!" });
    const training = await request(server.app)
      .post("/simulacao/api/auth/login")
      .send({ username: "admin", password: "123" });
    const url = `http://127.0.0.1:${address.port}/simulacao`;
    const rejected = connectSocket(url, {
      forceNew: true,
      reconnection: false,
      transports: ["websocket"],
      extraHeaders: { Cookie: real.headers["set-cookie"][0].split(";")[0] },
      auth: { csrfToken: real.body.csrfToken },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        rejected.once("connect_error", () => resolve());
        rejected.once("connect", () =>
          reject(new Error("Sessão operacional aceita no treinamento")),
        );
      });
    } finally {
      rejected.disconnect();
    }
    const valid = connectSocket(url, {
      forceNew: true,
      reconnection: false,
      transports: ["websocket"],
      extraHeaders: { Cookie: training.headers["set-cookie"][0].split(";")[0] },
      auth: { csrfToken: training.body.csrfToken },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        valid.once("connect", () => resolve());
        valid.once("connect_error", reject);
      });
      expect(valid.connected).toBe(true);
    } finally {
      valid.disconnect();
    }
  });
  it("rejeita outro nome para o mesmo arquivo físico antes de preparar treinamento", async () => {
    const directory = mkdtempSync(join(tmpdir(), "restaurant-alias-test-"));
    const real = join(directory, "real.sqlite"),
      alias = join(directory, "alias.sqlite");
    const initial = new Store(real);
    initial.close();
    linkSync(real, alias);
    try {
      expect(() => {
        const server = createApplication({ dbPath: real, simulationDbPath: alias });
        servers.push(server);
      }).toThrow(/bancos|arquivo|diferentes/i);
    } finally {
      for (const s of servers.splice(0)) await s.close();
      if (!resolve(directory).startsWith(resolve(tmpdir())))
        throw new Error("Diretório fora do escopo do teste");
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("separa credenciais, CSRF, dados e reset do banco operacional", async () => {
    const server = fixture(),
      agent = request.agent(server.app);
    const real = await agent
      .post("/api/auth/login")
      .send({ username: "admin", password: "Strong-password-123!" });
    expect(real.status).toBe(200);
    expect((await agent.get("/simulacao/api/auth/me")).status).toBe(401);
    const training = await agent
      .post("/simulacao/api/auth/login")
      .send({ username: "admin", password: "123" });
    expect(training.status).toBe(200);
    expect(training.headers["set-cookie"][0]).toContain("restaurant_training_session=");
    expect((await agent.get("/api/auth/me")).body.user.id).toBe(real.body.user.id);
    expect((await agent.get("/simulacao/api/auth/me")).body.user.id).toBe(
      training.body.user.id,
    );
    expect(
      (
        await agent
          .post("/simulacao/api/simulation/start")
          .set("X-CSRF-Token", real.body.csrfToken)
          .send({ mode: "automatic", maxGroups: 1 })
      ).status,
    ).toBe(403);
    expect(
      (
        await agent
          .post("/simulacao/api/simulation/start")
          .set("X-CSRF-Token", training.body.csrfToken)
          .send({
            mode: "automatic",
            maxGroups: 1,
            arrivalSeconds: 1,
            preparationSeconds: 1,
            diningSeconds: 1,
          })
      ).status,
    ).toBe(200);
    server.training!.engine.tick(20);
    expect((await agent.get("/simulacao/api/orders")).body).toHaveLength(1);
    expect((await agent.get("/api/orders")).body).toHaveLength(0);
    expect((await agent.get("/api/inventory")).body).toHaveLength(0);
    expect((await agent.get("/simulacao/api/inventory")).body.length).toBeGreaterThan(0);
    expect(
      (
        await agent
          .post("/simulacao/api/simulation/control")
          .set("X-CSRF-Token", training.body.csrfToken)
          .send({ action: "reset" })
      ).status,
    ).toBe(200);
    expect((await agent.get("/api/orders")).body).toHaveLength(0);
    expect((await agent.get("/simulacao/api/orders")).body).toHaveLength(0);
    expect((await agent.get("/api/auth/me")).status).toBe(200);
  });
  it("aplica papéis no treinamento e nega rotas de simulação no operacional", async () => {
    const server = fixture(),
      waiter = request.agent(server.app);
    const auth = await waiter
      .post("/simulacao/api/auth/login")
      .send({ username: "garcom", password: "123" });
    expect(auth.status).toBe(200);
    expect((await waiter.get("/simulacao/api/purchases")).status).toBe(403);
    expect((await waiter.get("/simulacao/api/analytics")).status).toBe(403);
    expect((await waiter.get("/simulacao/api/inventory")).status).toBe(403);
    expect(
      (
        await waiter
          .post("/simulacao/api/simulation/start")
          .set("X-CSRF-Token", auth.body.csrfToken)
          .send({})
      ).status,
    ).toBe(403);
    expect((await waiter.get("/api/auth/me")).status).toBe(401);
  });
});
