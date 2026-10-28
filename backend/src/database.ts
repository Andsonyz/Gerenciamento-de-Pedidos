import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  CreateOrder,
  Order,
  OrderItem,
  Product,
  Table,
} from "@restaurante/shared";
import { HttpError } from "./errors.js";

interface OrderRow {
  number: number;
  id: string;
  request_id: string;
  fingerprint: string;
  table_id: number;
  created_at: string;
  notes: string;
  status: Order["status"];
  items: string;
}
function fromRow(row: OrderRow): Order {
  return {
    id: row.id,
    number: row.number,
    requestId: row.request_id,
    tableId: row.table_id,
    createdAt: row.created_at,
    notes: row.notes,
    status: row.status,
    items: JSON.parse(row.items) as OrderItem[],
  };
}

export class OrderDatabase {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS restaurant_tables (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, priceCents INTEGER NOT NULL CHECK(priceCents >= 0));
      CREATE TABLE IF NOT EXISTS orders (
        number INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
        request_id TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
        table_id INTEGER NOT NULL REFERENCES restaurant_tables(id), created_at TEXT NOT NULL,
        notes TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'viewed')),
        items TEXT NOT NULL
      );`);
    const tableInsert = this.db.prepare(
      "INSERT OR IGNORE INTO restaurant_tables (id, name) VALUES (?, ?)",
    );
    for (let id = 1; id <= 12; id++)
      tableInsert.run(id, `Mesa ${id.toString().padStart(2, "0")}`);
    const productInsert = this.db.prepare(
      "INSERT OR IGNORE INTO products (id, name, category, priceCents) VALUES (?, ?, ?, ?)",
    );
    const products: Product[] = [
      {
        id: 1,
        name: "Hambúrguer da casa",
        category: "Pratos",
        priceCents: 2800,
      },
      {
        id: 2,
        name: "Filé de frango grelhado",
        category: "Pratos",
        priceCents: 3200,
      },
      { id: 3, name: "Salada da horta", category: "Pratos", priceCents: 2200 },
      { id: 4, name: "Batata frita", category: "Porções", priceCents: 1800 },
      { id: 5, name: "Suco de laranja", category: "Bebidas", priceCents: 900 },
      { id: 6, name: "Água mineral", category: "Bebidas", priceCents: 500 },
      {
        id: 7,
        name: "Refrigerante lata",
        category: "Bebidas",
        priceCents: 700,
      },
      {
        id: 8,
        name: "Pudim de leite",
        category: "Sobremesas",
        priceCents: 1200,
      },
    ];
    for (const product of products)
      productInsert.run(
        product.id,
        product.name,
        product.category,
        product.priceCents,
      );
  }
  tables(): Table[] {
    return this.db
      .prepare("SELECT * FROM restaurant_tables ORDER BY id")
      .all() as unknown as Table[];
  }
  products(): Product[] {
    return this.db
      .prepare("SELECT * FROM products ORDER BY id")
      .all() as unknown as Product[];
  }
  list(): Order[] {
    return (
      this.db
        .prepare("SELECT * FROM orders ORDER BY number DESC")
        .all() as unknown as OrderRow[]
    ).map(fromRow);
  }
  get(id: string): Order {
    const row = this.db
      .prepare("SELECT * FROM orders WHERE id = ?")
      .get(id) as unknown as OrderRow | undefined;
    if (!row) throw new HttpError(404, "Pedido não encontrado.");
    return fromRow(row);
  }
  create(input: CreateOrder): { order: Order; created: boolean } {
    const sortedItems = [...input.items].sort(
      (a, b) => a.productId - b.productId,
    );
    const fingerprint = JSON.stringify({
      tableId: input.tableId,
      items: sortedItems,
      notes: input.notes,
    });
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db
        .prepare("SELECT * FROM orders WHERE request_id = ?")
        .get(input.requestId) as unknown as OrderRow | undefined;
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new HttpError(
            409,
            "Esta chave de envio já pertence a outro pedido.",
          );
        this.db.exec("COMMIT");
        return { order: fromRow(existing), created: false };
      }
      if (
        !this.db
          .prepare("SELECT id FROM restaurant_tables WHERE id = ?")
          .get(input.tableId)
      )
        throw new HttpError(400, "Mesa inválida.");
      const items = sortedItems.map((item) => {
        const product = this.db
          .prepare("SELECT * FROM products WHERE id = ?")
          .get(item.productId) as unknown as Product | undefined;
        if (!product) throw new HttpError(400, "Produto inválido.");
        return {
          productId: product.id,
          name: product.name,
          priceCents: product.priceCents,
          quantity: item.quantity,
        };
      });
      const id = randomUUID();
      this.db
        .prepare(
          "INSERT INTO orders (id, request_id, fingerprint, table_id, created_at, notes, items) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          id,
          input.requestId,
          fingerprint,
          input.tableId,
          new Date().toISOString(),
          input.notes,
          JSON.stringify(items),
        );
      const order = this.get(id);
      this.db.exec("COMMIT");
      return { order, created: true };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  markViewed(id: string): Order {
    this.get(id);
    this.db.prepare("UPDATE orders SET status = 'viewed' WHERE id = ?").run(id);
    return this.get(id);
  }
  close(): void {
    this.db.close();
  }
}
