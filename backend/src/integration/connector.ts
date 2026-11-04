import { createHash, randomUUID } from "node:crypto";
import {
  EntitySchema,
  SyncEventSchema,
  SyncAckSchema,
  SnapshotStartSchema,
  validateBatchBytes,
} from "@mesa/contracts";
import type {
  Entity,
  SyncEvent,
  SnapshotStart,
  SourceCapabilities,
} from "@mesa/contracts";
import type { Store } from "../database/store.js";
import { TrainingResources } from "../modules/training-resources.js";
import { buildSyncSnapshot, installDirtyTriggers, serializeEntity } from "./serialize.js";
export interface ConnectorConfig {
  restaurantId: string;
  sourceId: string;
  token: string;
  endpoint: string;
}
const capabilities: SourceCapabilities = {
  sales: true,
  inventory: true,
  purchasing: true,
  finance: true,
  sponsorships: true,
  equipment: true,
  simulation: true,
};
interface Meta {
  restaurant_id: string;
  source_id: string;
  dataset_id: string;
  sequence: number;
  ack: number;
  generation: number;
  last_error: string | null;
}
interface Pending {
  id: number;
  kind: "snapshot" | "event";
  body: string;
}
function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.keys(v)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonical((v as Record<string, unknown>)[k]))
      .join(",") +
    "}"
  );
}
export class DashboardConnector {
  private stopped = false;
  private busy = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastHeartbeat = 0;
  private failures = 0;
  private readonly owner = randomUUID();
  constructor(
    readonly db: Store,
    readonly config: ConnectorConfig,
  ) {
    new TrainingResources(db);
    const url = new URL(config.endpoint);
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      )
    )
      throw new Error("Use HTTPS para sincronização remota.");
    if (url.username || url.password || url.search || url.hash)
      throw new Error("URL de sincronização inválida.");
    if (!/^[A-Za-z0-9_-]{40,256}$/.test(config.token))
      throw new Error("Token de dispositivo inválido.");
    db.raw
      .exec(`CREATE TABLE IF NOT EXISTS dashboard_sync_meta(id INTEGER PRIMARY KEY CHECK(id=1),restaurant_id TEXT NOT NULL,source_id TEXT NOT NULL,dataset_id TEXT NOT NULL,sequence INTEGER NOT NULL,ack INTEGER NOT NULL,generation INTEGER NOT NULL,last_error TEXT);
  CREATE TABLE IF NOT EXISTS dashboard_sync_outbox(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,body TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS dashboard_sync_dirty(kind TEXT NOT NULL,entity_id TEXT NOT NULL,PRIMARY KEY(kind,entity_id));
  CREATE TABLE IF NOT EXISTS dashboard_sync_lease(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT,until_ms INTEGER NOT NULL);
  INSERT OR IGNORE INTO dashboard_sync_lease VALUES(1,NULL,0);
  CREATE TABLE IF NOT EXISTS dashboard_sync_item_categories(dataset_id TEXT NOT NULL,item_id TEXT NOT NULL,category TEXT NOT NULL,PRIMARY KEY(dataset_id,item_id));`);
    const old = this.meta();
    if (
      old &&
      (old.source_id !== config.sourceId || old.restaurant_id !== config.restaurantId)
    )
      throw new Error(
        "Origem já configurada. Faça recuperação explícita para mudar identidade.",
      );
    if (!old)
      db.tx(() => {
        db.run(
          "INSERT INTO dashboard_sync_meta VALUES(1,?,?,?,0,0,0,NULL)",
          config.restaurantId,
          config.sourceId,
          randomUUID(),
        );
        this.enqueueSnapshot(true);
      });
    installDirtyTriggers(db);
    db.setCommitHook(() => this.capture());
    db.setDatasetResetHook(() => this.reset());
  }
  private meta() {
    return this.db.get<Meta>("SELECT * FROM dashboard_sync_meta WHERE id=1");
  }
  status() {
    const m = this.meta()!;
    return {
      sourceId: m.source_id,
      datasetId: m.dataset_id,
      sequence: m.sequence,
      ackSequence: m.ack,
      pending: this.db.get<{ n: number }>("SELECT COUNT(*) n FROM dashboard_sync_outbox")!
        .n,
      lastError: m.last_error,
    };
  }
  private enqueueSnapshot(initial: boolean) {
    const m = this.meta()!,
      entities = buildSyncSnapshot(this.db).map((e) => EntitySchema.parse(e) as Entity);
    const pendingSnapshots = this.db.get<{ n: number }>(
      "SELECT COUNT(*) n FROM dashboard_sync_outbox WHERE kind='snapshot'",
    )!.n;
    const chunks: Entity[][] = [];
    let part: Entity[] = [];
    for (const e of entities) {
      if (
        part.length >= 200 ||
        Buffer.byteLength(JSON.stringify([...part, e])) > 900_000
      ) {
        chunks.push(part);
        part = [];
      }
      part.push(e);
    }
    if (part.length || !chunks.length) chunks.push(part);
    const metadata: SnapshotStart = SnapshotStartSchema.parse({
      schemaVersion: 1,
      restaurantId: m.restaurant_id,
      sourceId: m.source_id,
      datasetId: m.dataset_id,
      snapshotId: randomUUID(),
      baseSequence: initial ? 0 : m.sequence - 1,
      watermark: m.sequence,
      expectedGeneration: m.generation + pendingSnapshots,
      count: entities.length,
      chunks: chunks.length,
      checksum: createHash("sha256").update(canonical(entities)).digest("hex"),
      label: `Rodada ${new Date().toLocaleString("pt-BR", { timeZone: "America/Fortaleza" })}`,
      startedAt: this.db.timestamp(),
      capabilities,
    });
    this.db.run(
      "INSERT INTO dashboard_sync_outbox(kind,body) VALUES(?,?)",
      "snapshot",
      JSON.stringify({ metadata, chunks }),
    );
  }
  private reset() {
    const m = this.meta()!;
    this.db.run(
      "UPDATE dashboard_sync_meta SET dataset_id=?,sequence=? WHERE id=1",
      randomUUID(),
      m.sequence + 1,
    );
    this.db.run("DELETE FROM dashboard_sync_dirty");
    this.enqueueSnapshot(false);
  }
  private capture() {
    const dirty = this.db.all<{ kind: Entity["type"]; entity_id: string }>(
      "SELECT * FROM dashboard_sync_dirty ORDER BY kind,entity_id",
    );
    if (!dirty.length) return;
    const payload: {
      upserts: Entity[];
      deletes: { type: Entity["type"]; id: string }[];
    } = { upserts: [], deletes: [] };
    for (const d of dirty) {
      const e = serializeEntity(this.db, d.kind, d.entity_id);
      if (e) payload.upserts.push(EntitySchema.parse(e) as Entity);
      else payload.deletes.push({ type: d.kind, id: d.entity_id });
    }
    const m = this.meta()!;
    const event = SyncEventSchema.parse({
      schemaVersion: 1,
      eventId: randomUUID(),
      restaurantId: m.restaurant_id,
      sourceId: m.source_id,
      datasetId: m.dataset_id,
      sequence: m.sequence + 1,
      occurredAt: this.db.timestamp(),
      recordedAt: new Date().toISOString(),
      kind: "change",
      payload,
    });
    validateBatchBytes({ events: [event] });
    this.db.run(
      "INSERT INTO dashboard_sync_outbox(kind,body) VALUES('event',?)",
      JSON.stringify(event),
    );
    this.db.run("UPDATE dashboard_sync_meta SET sequence=? WHERE id=1", m.sequence + 1);
    this.db.run("DELETE FROM dashboard_sync_dirty");
  }
  private assertLease() {
    const lease = this.db.get<{ owner: string | null; until_ms: number }>(
      "SELECT owner,until_ms FROM dashboard_sync_lease WHERE id=1",
    );
    if (lease?.owner !== this.owner || lease.until_ms <= Date.now())
      throw new Error(
        "A posse do envio expirou (lease); a fila será conferida novamente.",
      );
  }
  async flushOnce(transport: typeof fetch = fetch) {
    if (this.busy) return;
    this.busy = true;
    try {
      const acquired = this.db.run(
        "UPDATE dashboard_sync_lease SET owner=?,until_ms=? WHERE id=1 AND (owner IS NULL OR owner=? OR until_ms<?)",
        this.owner,
        Date.now() + 30000,
        this.owner,
        Date.now(),
      );
      if (!acquired.changes)
        throw new Error("Outro conector possui o envio desta origem.");
      const send = async (action: string, body: unknown) => {
        validateBatchBytes(body);
        const renewed = this.db.run(
          "UPDATE dashboard_sync_lease SET until_ms=? WHERE id=1 AND owner=?",
          Date.now() + 30000,
          this.owner,
        );
        if (!renewed.changes) throw new Error("A posse do envio mudou (lease).");
        const response = await transport(
          this.config.endpoint.replace(/\/$/, "") + "/" + action,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              authorization: "Bearer " + this.config.token,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10_000),
          },
        );
        if (!response.ok) {
          const b = (await response
            .json()
            .catch(() => ({ error: "Falha de sincronização" }))) as { error?: string };
          throw new Error(`Sincronização ${response.status}: ${b.error ?? "falha"}`);
        }
        return response.json() as Promise<unknown>;
      };
      const pending = this.db.all<Pending>(
        "SELECT * FROM dashboard_sync_outbox ORDER BY id LIMIT 100",
      );
      if (pending[0]?.kind === "snapshot") {
        const { metadata, chunks } = JSON.parse(pending[0].body) as {
          metadata: SnapshotStart;
          chunks: Entity[][];
        };
        await send("snapshot/start", metadata);
        for (let i = 0; i < chunks.length; i++)
          await send("snapshot/chunk", {
            snapshotId: metadata.snapshotId,
            index: i,
            entities: chunks[i],
          });
        const ack = SyncAckSchema.parse(
          await send("snapshot/commit", { snapshotId: metadata.snapshotId }),
        );
        if (ack.ackSequence !== metadata.watermark)
          throw new Error("ACK de snapshot incompatível; recuperação necessária.");
        this.db.tx(() => {
          this.assertLease();
          this.db.run("DELETE FROM dashboard_sync_outbox WHERE id=?", pending[0]!.id);
          this.db.run(
            "UPDATE dashboard_sync_meta SET ack=?,generation=generation+1,last_error=NULL WHERE id=1",
            ack.ackSequence,
          );
        });
      } else if (pending.length) {
        const events: SyncEvent[] = [];
        const ids: number[] = [];
        for (const p of pending) {
          if (p.kind !== "event") break;
          const e = JSON.parse(p.body) as SyncEvent;
          try {
            validateBatchBytes({ events: [...events, e] });
          } catch {
            break;
          }
          events.push(e);
          ids.push(p.id);
        }
        const ack = SyncAckSchema.parse(await send("events", { events }));
        if (ack.ackSequence !== events.at(-1)!.sequence)
          throw new Error("ACK fora da sequência enviada");
        this.db.tx(() => {
          this.assertLease();
          for (const id of ids)
            this.db.run("DELETE FROM dashboard_sync_outbox WHERE id=?", id);
          this.db.run(
            "UPDATE dashboard_sync_meta SET ack=?,last_error=NULL WHERE id=1",
            ack.ackSequence,
          );
        });
      }
      if (Date.now() - this.lastHeartbeat >= 15_000) {
        await send("heartbeat", {
          sourceId: this.config.sourceId,
          pending: this.status().pending,
          error: null,
          capabilities,
        });
        this.lastHeartbeat = Date.now();
      }
      this.failures = 0;
    } catch (e) {
      this.failures++;
      this.db.run(
        "UPDATE dashboard_sync_meta SET last_error=? WHERE id=1",
        e instanceof Error ? e.message.slice(0, 500) : "Falha de rede",
      );
      throw e;
    } finally {
      this.db.run(
        "UPDATE dashboard_sync_lease SET owner=NULL,until_ms=0 WHERE id=1 AND owner=?",
        this.owner,
      );
      this.busy = false;
    }
  }
  start() {
    const tick = async () => {
      if (this.stopped) return;
      try {
        await this.flushOnce();
      } catch {
        /* Queue remains durable; status reports failure without printing credentials. */
      }
      if (!this.stopped) {
        const delay = this.failures
          ? Math.min(60_000, 1000 * 2 ** Math.min(this.failures - 1, 6)) *
            (0.8 + Math.random() * 0.4)
          : this.status().pending
            ? 5
            : 1000;
        this.timer = setTimeout(() => void tick(), delay);
        this.timer.unref();
      }
    };
    void tick();
    return this;
  }
  async close() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    while (this.busy) await new Promise((r) => setTimeout(r, 10));
    this.db.setCommitHook();
    this.db.setDatasetResetHook();
  }
}
