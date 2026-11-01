import { randomUUID } from "node:crypto";
import type {
  Page,
  Purchase,
  PurchaseInput,
  PurchaseItem,
  PurchaseReceiveInput,
  PurchaseReceipt,
  PurchaseStatus,
  Supplier,
  SupplierInput,
  User,
} from "@restaurante/shared";
import { Store } from "../database/store.js";
import { HttpError } from "../errors.js";
import {
  exactInteger,
  Inventory,
  requestKey,
  requiredText,
  requireAdmin,
} from "./inventory.js";

export class Purchasing {
  constructor(readonly db: Store) {}
  listSuppliers(): Supplier[] {
    return this.db
      .all<Omit<Supplier, "ingredientIds" | "active"> & { active: number }>(
        "SELECT id,name,phone,email,active,created_at AS createdAt FROM suppliers ORDER BY name",
      )
      .map((s) => ({
        ...s,
        active: !!s.active,
        ingredientIds: this.db
          .all<{ id: string }>(
            "SELECT ingredient_id AS id FROM supplier_ingredients WHERE supplier_id=? ORDER BY ingredient_id",
            s.id,
          )
          .map((i) => i.id),
      }));
  }
  saveSupplier(user: User, input: SupplierInput, id?: string): Supplier {
    requireAdmin(user);
    const name = requiredText(input.name, 120, 1);
    if (
      typeof input.active !== "boolean" ||
      typeof input.phone !== "string" ||
      input.phone.length > 80 ||
      typeof input.email !== "string" ||
      input.email.length > 200 ||
      (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) ||
      !Array.isArray(input.ingredientIds) ||
      input.ingredientIds.length > 1000 ||
      new Set(input.ingredientIds).size !== input.ingredientIds.length
    )
      throw new HttpError(400, "Dados do fornecedor inválidos.");
    return this.db.tx(() => {
      const before = id ? this.listSuppliers().find((s) => s.id === id) : null;
      if (id && !before) throw new HttpError(404, "Fornecedor não encontrado.");
      for (const ingredientId of input.ingredientIds)
        if (!this.db.get("SELECT id FROM ingredients WHERE id=?", ingredientId))
          throw new HttpError(400, "Ingrediente associado não encontrado.");
      const supplierId = id ?? randomUUID();
      this.db.run(
        "INSERT INTO suppliers(id,name,phone,email,active,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,phone=excluded.phone,email=excluded.email,active=excluded.active",
        supplierId,
        name,
        input.phone.trim(),
        input.email.trim(),
        Number(input.active),
        this.db.timestamp(),
      );
      // Associations are configuration, not financial history; historical purchase snapshots remain immutable.
      this.db.run("DELETE FROM supplier_ingredients WHERE supplier_id=?", supplierId);
      for (const ingredientId of input.ingredientIds)
        this.db.run(
          "INSERT INTO supplier_ingredients VALUES(?,?)",
          supplierId,
          ingredientId,
        );
      this.db.audit(user.id, "supplier.saved", supplierId, { before, after: input });
      return this.listSuppliers().find((s) => s.id === supplierId)!;
    });
  }
  list(
    query: { page?: number; status?: PurchaseStatus; supplierId?: string } = {},
  ): Page<Purchase> {
    const page = exactInteger(query.page ?? 1, 1, 1_000_000),
      pageSize = 50;
    const conditions: string[] = [],
      params: string[] = [];
    if (query.status) {
      conditions.push("status=?");
      params.push(query.status);
    }
    if (query.supplierId) {
      conditions.push("supplier_id=?");
      params.push(query.supplierId);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const total = this.db.get<{ total: number }>(
      `SELECT COUNT(*) AS total FROM purchases ${where}`,
      ...params,
    )!.total;
    const ids = this.db.all<{ id: string }>(
      `SELECT id FROM purchases ${where} ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      (page - 1) * pageSize,
    );
    return { items: ids.map((i) => this.get(i.id)), total, page, pageSize };
  }
  get(id: string): Purchase {
    const row = this.db.get<
      Omit<Purchase, "items" | "receipts" | "totalCents" | "receivedCents">
    >(
      "SELECT id,supplier_id AS supplierId,supplier_name AS supplierName,notes,status,created_at AS createdAt,confirmed_at AS confirmedAt,cancelled_at AS cancelledAt,cancellation_reason AS cancellationReason FROM purchases WHERE id=?",
      id,
    );
    if (!row) throw new HttpError(404, "Compra não encontrada.");
    const items = this.db.all<PurchaseItem>(
      "SELECT id,ingredient_id AS ingredientId,ingredient_name AS ingredientName,unit,quantity,total_cents AS totalCents,received_quantity AS receivedQuantity,received_cents AS receivedCents FROM purchase_items WHERE purchase_id=? ORDER BY rowid",
      id,
    );
    const receipts = this.db
      .all<Omit<PurchaseReceipt, "items">>(
        "SELECT r.id,r.created_at AS createdAt,u.name AS userName FROM purchase_receipts r JOIN users u ON u.id=r.user_id WHERE r.purchase_id=? ORDER BY r.created_at,r.rowid",
        id,
      )
      .map((r) => ({
        ...r,
        items: this.db.all<PurchaseReceipt["items"][number]>(
          "SELECT item_id AS itemId,quantity,total_cents AS totalCents FROM purchase_receipt_items WHERE receipt_id=?",
          r.id,
        ),
      }));
    return {
      ...row,
      items,
      receipts,
      totalCents: items.reduce((sum, i) => sum + i.totalCents, 0),
      receivedCents: items.reduce((sum, i) => sum + i.receivedCents, 0),
    };
  }
  savePurchase(user: User, input: PurchaseInput, id?: string): Purchase {
    requireAdmin(user);
    requestKey(input.requestId);
    if (
      typeof input.notes !== "string" ||
      input.notes.length > 1000 ||
      !Array.isArray(input.items) ||
      !input.items.length ||
      input.items.length > 100 ||
      new Set(input.items.map((i) => i.ingredientId)).size !== input.items.length
    )
      throw new HttpError(400, "Itens da compra inválidos.");
    // The returned snapshot intentionally matches the original response on replay.
    return this.db.operation(
      user.id,
      input.requestId,
      "purchase.save",
      { id: id ?? null, ...input },
      () => {
        const before = id ? this.get(id) : null;
        if (before && before.status !== "draft")
          throw new HttpError(409, "Somente rascunhos podem ser editados.");
        const supplier = this.listSuppliers().find(
          (s) => s.id === input.supplierId && s.active,
        );
        if (!supplier) throw new HttpError(400, "Fornecedor inexistente ou inativo.");
        const inventory = new Inventory(this.db);
        for (const item of input.items) {
          exactInteger(item.quantity, 1);
          exactInteger(item.totalCents, 0, 100_000_000);
          if (!inventory.ingredient(item.ingredientId).active)
            throw new HttpError(400, "Ingrediente inativo na compra.");
        }
        const purchaseId = id ?? randomUUID();
        this.db.run(
          "INSERT INTO purchases(id,supplier_id,supplier_name,notes,status,created_at,user_id) VALUES(?,?,?,?,'draft',?,?) ON CONFLICT(id) DO UPDATE SET supplier_id=excluded.supplier_id,supplier_name=excluded.supplier_name,notes=excluded.notes",
          purchaseId,
          supplier.id,
          supplier.name,
          input.notes.trim(),
          this.db.timestamp(),
          user.id,
        );
        if (before)
          this.db.run("DELETE FROM purchase_items WHERE purchase_id=?", purchaseId);
        for (const item of input.items) {
          const ingredient = inventory.ingredient(item.ingredientId);
          this.db.run(
            "INSERT INTO purchase_items(id,purchase_id,ingredient_id,ingredient_name,unit,quantity,total_cents) VALUES(?,?,?,?,?,?,?)",
            randomUUID(),
            purchaseId,
            ingredient.id,
            ingredient.name,
            ingredient.unit,
            item.quantity,
            item.totalCents,
          );
          this.db.run(
            "INSERT OR IGNORE INTO supplier_ingredients VALUES(?,?)",
            supplier.id,
            ingredient.id,
          );
        }
        this.db.audit(user.id, "purchase.saved", purchaseId, { before, after: input });
        return this.get(purchaseId);
      },
    ).value;
  }
  confirm(user: User, id: string, requestId: string) {
    requireAdmin(user);
    requestKey(requestId);
    return this.db.operation(user.id, requestId, "purchase.confirm", { id }, () => {
      const purchase = this.get(id);
      if (purchase.status !== "draft")
        throw new HttpError(409, "Somente rascunhos podem ser confirmados.");
      if (
        !this.db.get(
          "SELECT id FROM suppliers WHERE id=? AND active=1",
          purchase.supplierId,
        )
      )
        throw new HttpError(409, "Fornecedor está inativo.");
      for (const item of purchase.items)
        if (!new Inventory(this.db).ingredient(item.ingredientId).active)
          throw new HttpError(409, "Compra contém ingrediente inativo.");
      this.db.run(
        "UPDATE purchases SET status='confirmed',confirmed_at=? WHERE id=?",
        this.db.timestamp(),
        id,
      );
      this.db.audit(user.id, "purchase.confirmed", id, {
        totalCents: purchase.totalCents,
      });
      return this.get(id);
    });
  }
  receive(user: User, id: string, input: PurchaseReceiveInput) {
    requireAdmin(user);
    requestKey(input.requestId);
    if (
      !Array.isArray(input.items) ||
      !input.items.length ||
      input.items.length > 100 ||
      new Set(input.items.map((i) => i.itemId)).size !== input.items.length
    )
      throw new HttpError(400, "Itens de recebimento inválidos.");
    return this.db.operation(
      user.id,
      input.requestId,
      "purchase.receive",
      { id, ...input },
      () => {
        const purchase = this.get(id);
        if (!["confirmed", "partially_received"].includes(purchase.status))
          throw new HttpError(409, "Compra não está disponível para recebimento.");
        const receiptId = randomUUID(),
          inventory = new Inventory(this.db);
        const receiving = input.items.map((received) => {
          exactInteger(received.quantity, 1);
          const item = purchase.items.find((i) => i.id === received.itemId);
          if (!item || received.quantity > item.quantity - item.receivedQuantity)
            throw new HttpError(409, "Quantidade excede o saldo da compra.");
          const newQuantity = item.receivedQuantity + received.quantity;
          // Allocate integer cents cumulatively. The final receipt always closes the exact line total.
          const newCents = Number(
            (BigInt(item.totalCents) * BigInt(newQuantity)) / BigInt(item.quantity),
          );
          return {
            item,
            newQuantity,
            newCents,
            quantity: received.quantity,
            amount: newCents - item.receivedCents,
          };
        });
        this.db.run(
          "INSERT INTO purchase_receipts VALUES(?,?,?,?)",
          receiptId,
          id,
          user.id,
          this.db.timestamp(),
        );
        for (const received of receiving) {
          this.db.run(
            "UPDATE purchase_items SET received_quantity=?,received_cents=? WHERE id=?",
            received.newQuantity,
            received.newCents,
            received.item.id,
          );
          this.db.run(
            "INSERT INTO purchase_receipt_items VALUES(?,?,?,?)",
            receiptId,
            received.item.id,
            received.quantity,
            received.amount,
          );
          inventory.record(
            user,
            received.item.ingredientId,
            "receipt",
            received.quantity,
            0,
            0,
            `${receiptId}:${received.item.id}`,
            `Recebimento da compra ${id}`,
          );
        }
        const remaining = this.db.get<{ remaining: number }>(
          "SELECT SUM(quantity-received_quantity) AS remaining FROM purchase_items WHERE purchase_id=?",
          id,
        )!.remaining;
        this.db.run(
          "UPDATE purchases SET status=? WHERE id=?",
          remaining ? "partially_received" : "received",
          id,
        );
        this.db.audit(user.id, "purchase.received", id, {
          receiptId,
          items: receiving.map((r) => ({
            itemId: r.item.id,
            quantity: r.quantity,
            totalCents: r.amount,
          })),
        });
        return this.get(id);
      },
    );
  }
  cancel(user: User, id: string, requestId: string, reason: string) {
    requireAdmin(user);
    requestKey(requestId);
    const justification = requiredText(reason);
    return this.db.operation(
      user.id,
      requestId,
      "purchase.cancel",
      { id, reason },
      () => {
        const purchase = this.get(id);
        if (["received", "cancelled"].includes(purchase.status))
          throw new HttpError(
            409,
            "Compra recebida ou já cancelada não permite cancelar saldo.",
          );
        this.db.run(
          "UPDATE purchases SET status='cancelled',cancelled_at=?,cancellation_reason=? WHERE id=?",
          this.db.timestamp(),
          justification,
          id,
        );
        this.db.audit(user.id, "purchase.cancelled", id, {
          reason: justification,
          receivedCents: purchase.receivedCents,
        });
        return this.get(id);
      },
    );
  }
  priceHistory(ingredientId: string) {
    new Inventory(this.db).ingredient(ingredientId);
    return this.db.all<{
      receiptId: string;
      purchaseId: string;
      supplierName: string;
      quantity: number;
      totalCents: number;
      createdAt: string;
    }>(
      "SELECT r.id AS receiptId,p.id AS purchaseId,p.supplier_name AS supplierName,ri.quantity,ri.total_cents AS totalCents,r.created_at AS createdAt FROM purchase_receipt_items ri JOIN purchase_receipts r ON r.id=ri.receipt_id JOIN purchase_items i ON i.id=ri.item_id JOIN purchases p ON p.id=r.purchase_id WHERE i.ingredient_id=? ORDER BY r.created_at DESC,r.rowid DESC LIMIT 100",
      ingredientId,
    );
  }
}
