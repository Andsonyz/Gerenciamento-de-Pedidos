import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { premiumSchema } from "./migrations.js";
import { OrderDatabase } from "../database.js";
import { HttpError } from "../errors.js";
import type { Order } from "@restaurante/shared";

export const now = () => new Date().toISOString();
export class Store {
  readonly raw: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    // The legacy initializer is retained to seed/import the existing installation.
    // A checkpoint plus backup protects existing files before the first migration.
    if (path !== ":memory:" && existsSync(path)) {
      const probe = new DatabaseSync(path);
      const migrated = probe
        .prepare("SELECT name FROM sqlite_master WHERE name='schema_migrations'")
        .get();
      if (!migrated) {
        const checkpoint = probe.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get() as {
          busy: number;
        };
        probe.close();
        if (checkpoint.busy)
          throw new Error("Encerre outros servidores antes de migrar o banco.");
        copyFileSync(path, `${path}.pre-premium.bak`);
      } else probe.close();
    }
    const legacy = new OrderDatabase(path);
    const tables = legacy.tables(),
      products = legacy.products(),
      orders = legacy.list();
    legacy.close();
    this.raw = new DatabaseSync(path);
    this.raw.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
    this.tx(() => {
      this.raw.exec(premiumSchema);
      if (this.get("SELECT version FROM schema_migrations WHERE version=2")) return;
      for (const table of tables)
        this.run("INSERT INTO dining_tables(id,name) VALUES(?,?)", table.id, table.name);
      for (const p of products) {
        this.run("INSERT OR IGNORE INTO categories(name) VALUES(?)", p.category);
        this.run(
          "INSERT INTO menu_products(id,name,category_id,price_cents) VALUES(?,?,(SELECT id FROM categories WHERE name=?),?)",
          p.id,
          p.name,
          p.category,
          p.priceCents,
        );
      }
      for (const order of [...orders].reverse()) this.importOrder(order);
      this.run("INSERT INTO schema_migrations VALUES(2,?)", now());
      this.audit(null, "migration.premium", "2", { orders: orders.length });
    });
  }
  private importOrder(order: Order) {
    let session = this.get<{ id: string }>(
      "SELECT id FROM table_sessions WHERE table_id=? AND status!=?",
      order.tableId,
      "closed",
    );
    if (!session) {
      session = { id: randomUUID() };
      this.run(
        "INSERT INTO table_sessions(id,table_id,opened_at) VALUES(?,?,?)",
        session.id,
        order.tableId,
        order.createdAt,
      );
      this.run("UPDATE dining_tables SET status='occupied' WHERE id=?", order.tableId);
    }
    this.run(
      "INSERT INTO service_orders(number,id,request_id,session_id,created_at,notes,status) VALUES(?,?,?,?,?,?,'received')",
      order.number,
      order.id,
      order.requestId,
      session.id,
      order.createdAt,
      order.notes,
    );
    for (const item of order.items)
      this.run(
        "INSERT INTO order_items(id,order_id,product_id,name,quantity,price_cents) VALUES(?,?,?,?,?,?)",
        randomUUID(),
        order.id,
        item.productId,
        item.name,
        item.quantity,
        item.priceCents,
      );
    this.run(
      "INSERT INTO print_jobs(id,order_id,type,status,created_at,displayed_at,payload) VALUES(?,?,?,?,?,?,?)",
      randomUUID(),
      order.id,
      "order",
      order.status === "viewed" ? "displayed" : "pending",
      order.createdAt,
      order.status === "viewed" ? order.createdAt : null,
      JSON.stringify({
        items: order.items.map((i) => ({ name: i.name, quantity: i.quantity })),
        notes: order.notes,
        reason: null,
      }),
    );
  }
  get<T = Record<string, unknown>>(
    sql: string,
    ...params: SQLInputValue[]
  ): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }
  all<T = Record<string, unknown>>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }
  run(sql: string, ...params: SQLInputValue[]) {
    return this.raw.prepare(sql).run(...params);
  }
  tx<T>(fn: () => T): T {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.raw.exec("COMMIT");
      return value;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
  }
  audit(userId: string | null, action: string, entityId: string, detail: unknown) {
    this.run(
      "INSERT INTO audit_log(user_id,action,entity_id,detail,created_at) VALUES(?,?,?,?,?)",
      userId,
      action,
      entityId,
      JSON.stringify(detail),
      now(),
    );
  }
  operation<T>(
    userId: string,
    requestId: string,
    kind: string,
    payload: unknown,
    fn: () => T,
  ): { value: T; created: boolean } {
    const fingerprint = JSON.stringify(payload);
    return this.tx(() => {
      const prior = this.get<{
        user_id: string;
        kind: string;
        fingerprint: string;
        response: string;
      }>("SELECT * FROM operations WHERE request_id=?", requestId);
      if (prior) {
        if (
          prior.user_id !== userId ||
          prior.kind !== kind ||
          prior.fingerprint !== fingerprint
        )
          throw new HttpError(
            409,
            "Chave já utilizada em outra operação.",
            "REQUEST_ID_CONFLICT",
          );
        return { value: JSON.parse(prior.response) as T, created: false };
      }
      const value = fn();
      this.run(
        "INSERT INTO operations VALUES(?,?,?,?,?,?)",
        requestId,
        userId,
        kind,
        fingerprint,
        JSON.stringify(value),
        now(),
      );
      return { value, created: true };
    });
  }
  close() {
    this.raw.close();
  }
}
