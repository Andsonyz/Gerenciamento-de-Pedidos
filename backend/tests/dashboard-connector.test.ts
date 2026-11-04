import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Store } from "../src/database/store.js";
import { seedSimulation } from "../src/modules/simulation-seed.js";
import { TrainingResources } from "../src/modules/training-resources.js";
import { Inventory } from "../src/modules/inventory.js";
import { DashboardConnector } from "../src/integration/connector.js";
const stores: Store[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
});
function setup() {
  const db = new Store(":memory:");
  stores.push(db);
  const user = seedSimulation(db)[0]!;
  new TrainingResources(db);
  const connector = new DashboardConnector(db, {
    restaurantId: randomUUID(),
    sourceId: randomUUID(),
    token: "t".repeat(43),
    endpoint: "http://127.0.0.1:8788/functions/v1/sync-ingest",
  });
  return { db, user, connector };
}
describe("outbox persistente no treinamento", () => {
  it("ACK atrasado não confirma de novo após outro emissor assumir e concluir o snapshot", async () => {
    const { connector, db } = setup();
    await expect(
      connector.flushOnce(async (url) => {
        if (String(url).endsWith("/snapshot/commit")) {
          db.tx(() => {
            db.run("DELETE FROM dashboard_sync_outbox");
            db.run("UPDATE dashboard_sync_meta SET generation=1,ack=0 WHERE id=1");
            db.run("UPDATE dashboard_sync_lease SET owner=NULL,until_ms=0 WHERE id=1");
          });
          return Response.json({ ackSequence: 0, revision: 1 });
        }
        return Response.json({ ok: true });
      }),
    ).rejects.toThrow(/lease|posse/);
    expect(
      db.get<{ generation: number }>("SELECT generation FROM dashboard_sync_meta")!
        .generation,
    ).toBe(1);
  });
  it("nega inicialização no banco operacional e HTTP fora de loopback", () => {
    const db = new Store(":memory:");
    stores.push(db);
    expect(
      () =>
        new DashboardConnector(db, {
          restaurantId: randomUUID(),
          sourceId: randomUUID(),
          token: "t".repeat(43),
          endpoint: "https://example.com",
        }),
    ).toThrow(/treinamento/);
    const { db: training } = setup();
    expect(
      () =>
        new DashboardConnector(training, {
          restaurantId: randomUUID(),
          sourceId: randomUUID(),
          token: "t".repeat(43),
          endpoint: "http://192.168.0.1",
        }),
    ).toThrow(/HTTPS/);
  });
  it("grava a alteração e seu evento juntos e rollback não deixa evento órfão", () => {
    const { db, user } = setup();
    const before = db.get<{ n: number }>(
      "select count(*) n from dashboard_sync_outbox",
    )!.n;
    new Inventory(db).saveIngredient(user, {
      name: "Farinha",
      unit: "g",
      minimum: 0,
      active: true,
    });
    expect(db.get<{ n: number }>("select count(*) n from dashboard_sync_outbox")!.n).toBe(
      before + 1,
    );
    const count = db.get<{ n: number }>(
      "select count(*) n from dashboard_sync_outbox",
    )!.n;
    expect(() =>
      db.tx(() => {
        new Inventory(db).saveIngredient(user, {
          name: "Rollback",
          unit: "g",
          minimum: 0,
          active: true,
        });
        throw new Error("abort");
      }),
    ).toThrow();
    expect(db.get<{ n: number }>("select count(*) n from dashboard_sync_outbox")!.n).toBe(
      count,
    );
    expect(new Inventory(db).stock().find((i) => i.name === "Rollback")).toBeUndefined();
  });
  it("reset preserva eventos anteriores, captura seed novo e não reutiliza dataset", () => {
    const { db, user, connector } = setup();
    new Inventory(db).saveIngredient(user, {
      name: "Anterior",
      unit: "un",
      minimum: 0,
      active: true,
    });
    const first = connector.status().datasetId;
    db.tx(() => {
      db.run("delete from ingredients");
      db.markDatasetReset();
    });
    const second = connector.status().datasetId;
    expect(second).not.toBe(first);
    db.tx(() => db.markDatasetReset());
    expect(connector.status().datasetId).not.toBe(second);
    expect(
      db.get<{ n: number }>(
        "select count(*) n from dashboard_sync_outbox where kind='snapshot'",
      )!.n,
    ).toBe(3);
    expect(
      db.get<{ n: number }>(
        "select count(*) n from dashboard_sync_outbox where kind='event'",
      )!.n,
    ).toBeGreaterThan(0);
  });
  it("falha de rede preserva a fila e não remove eventos sem ACK", async () => {
    const { connector, db } = setup();
    const count = db.get<{ n: number }>(
      "select count(*) n from dashboard_sync_outbox",
    )!.n;
    await expect(
      connector.flushOnce(async () => {
        throw new Error("rede indisponível");
      }),
    ).rejects.toThrow();
    expect(db.get<{ n: number }>("select count(*) n from dashboard_sync_outbox")!.n).toBe(
      count,
    );
    expect(connector.status().lastError).toContain("rede");
  });
  it("não envia quando outro processo possui lease vigente", async () => {
    const { connector, db } = setup();
    db.run(
      "INSERT OR REPLACE INTO dashboard_sync_lease VALUES(1,'outro-processo',?)",
      Date.now() + 60000,
    );
    let requests = 0;
    await expect(
      connector.flushOnce(async () => {
        requests++;
        return new Response("{}");
      }),
    ).rejects.toThrow(/conector/);
    expect(requests).toBe(0);
  });
});
