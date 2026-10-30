import { randomUUID } from "node:crypto";
import type {
  AuditEntry,
  Bill,
  CatalogProduct,
  Category,
  CreateOrder,
  Dashboard,
  DiningTable,
  PremiumOrder,
  PremiumOrderItem,
  Payment,
  RestaurantSettings,
  User,
  OrderStatus,
} from "@restaurante/shared";
import { Store, now } from "../database/store.js";
import { HttpError } from "../errors.js";
import type { PrintQueueAdapter } from "../printing/PrinterAdapter.js";

interface SessionRow {
  id: string;
  table_id: number;
  opened_at: string;
  closed_at: string | null;
  status: Bill["status"];
  discount_cents: number;
  service_cents: number;
  waived_cents: number;
}
export class Restaurant {
  constructor(
    readonly db: Store,
    readonly printer: PrintQueueAdapter,
  ) {}
  settings(): RestaurantSettings {
    const r = this.db.get<{ name: string; other_payment_enabled: number }>(
      "SELECT * FROM restaurant_settings WHERE id=1",
    )!;
    return { name: r.name, otherPaymentEnabled: !!r.other_payment_enabled };
  }
  saveSettings(user: User, data: RestaurantSettings) {
    return this.db.tx(() => {
      this.db.run(
        "UPDATE restaurant_settings SET name=?,other_payment_enabled=? WHERE id=1",
        data.name,
        Number(data.otherPaymentEnabled),
      );
      this.db.audit(user.id, "settings.updated", "1", data);
      return this.settings();
    });
  }
  tables(): DiningTable[] {
    return this.db.all<DiningTable>(
      "SELECT t.id,t.name,t.status,s.id as sessionId FROM dining_tables t LEFT JOIN table_sessions s ON s.table_id=t.id AND s.status!='closed' ORDER BY t.id",
    );
  }
  categories(): Category[] {
    return this.db.all<Category>("SELECT * FROM categories ORDER BY name");
  }
  products(admin = false): CatalogProduct[] {
    return this.db
      .all<
        Omit<CatalogProduct, "active" | "available"> & {
          active: number;
          available: number;
        }
      >(
        `SELECT p.id,p.name,c.name as category,p.price_cents as priceCents,p.active,p.available FROM menu_products p JOIN categories c ON c.id=p.category_id ${admin ? "" : "WHERE p.active=1"} ORDER BY c.name,p.name`,
      )
      .map((p) => ({ ...p, active: !!p.active, available: !!p.available }));
  }
  category(user: User, name: string) {
    return this.db.tx(() => {
      this.db.run("INSERT OR IGNORE INTO categories(name) VALUES(?)", name);
      const category = this.db.get<Category>(
        "SELECT * FROM categories WHERE name=?",
        name,
      )!;
      this.db.audit(user.id, "category.saved", String(category.id), { name });
      return category;
    });
  }
  saveProduct(
    user: User,
    input: Omit<CatalogProduct, "id">,
    id?: number,
  ): CatalogProduct {
    return this.db.tx(() => {
      const previous = id ? this.products(true).find((p) => p.id === id) : null;
      if (id && !previous) throw new HttpError(404, "Produto não encontrado.");
      this.db.run("INSERT OR IGNORE INTO categories(name) VALUES(?)", input.category);
      const category = this.db.get<Category>(
        "SELECT * FROM categories WHERE name=?",
        input.category,
      )!;
      let productId = id;
      if (id)
        this.db.run(
          "UPDATE menu_products SET name=?,category_id=?,price_cents=?,active=?,available=? WHERE id=?",
          input.name,
          category.id,
          input.priceCents,
          Number(input.active),
          Number(input.available),
          id,
        );
      else
        productId = Number(
          this.db.run(
            "INSERT INTO menu_products(name,category_id,price_cents,active,available) VALUES(?,?,?,?,?)",
            input.name,
            category.id,
            input.priceCents,
            Number(input.active),
            Number(input.available),
          ).lastInsertRowid,
        );
      this.db.audit(user.id, "product.saved", String(productId), {
        before: previous,
        after: input,
      });
      return this.products(true).find((p) => p.id === productId)!;
    });
  }
  session(id: string): SessionRow {
    const row = this.db.get<SessionRow>("SELECT * FROM table_sessions WHERE id=?", id);
    if (!row) throw new HttpError(404, "Atendimento não encontrado.");
    return row;
  }
  requireOpen(id: string) {
    const row = this.session(id);
    if (row.status === "closed") throw new HttpError(409, "Atendimento já encerrado.");
    return row;
  }
  open(user: User, tableId: number, requestId: string) {
    return this.db.operation(user.id, requestId, "table.open", { tableId }, () => {
      const table = this.tables().find((t) => t.id === tableId);
      if (!table) throw new HttpError(404, "Mesa não encontrada.");
      if (table.sessionId) return this.bill(table.sessionId);
      if (
        table.status === "unavailable" ||
        (table.status === "reserved" && user.role === "waiter")
      )
        throw new HttpError(409, "Mesa indisponível para abertura.");
      const id = randomUUID();
      this.db.run(
        "INSERT INTO table_sessions(id,table_id,opened_at) VALUES(?,?,?)",
        id,
        tableId,
        now(),
      );
      this.db.run("UPDATE dining_tables SET status='occupied' WHERE id=?", tableId);
      this.db.audit(user.id, "table.opened", id, { tableId });
      return this.bill(id);
    });
  }
  tableStatus(user: User, id: number, status: "available" | "reserved" | "unavailable") {
    return this.db.tx(() => {
      const table = this.tables().find((t) => t.id === id);
      if (!table) throw new HttpError(404, "Mesa não encontrada.");
      if (table.sessionId)
        throw new HttpError(
          409,
          "Encerre o atendimento antes de alterar a disponibilidade.",
        );
      this.db.run("UPDATE dining_tables SET status=? WHERE id=?", status, id);
      this.db.audit(user.id, "table.status", String(id), {
        before: table.status,
        after: status,
      });
      return this.tables().find((t) => t.id === id)!;
    });
  }
  listOrders(user?: User): PremiumOrder[] {
    const ids = this.db.all<{ id: string }>(
      `SELECT id FROM service_orders ${user?.role === "waiter" ? "WHERE user_id=?" : ""} ORDER BY number DESC`,
      ...(user?.role === "waiter" ? [user.id] : []),
    );
    return ids.map((o) => this.order(o.id));
  }
  order(id: string): PremiumOrder {
    const row = this.db.get<Omit<PremiumOrder, "items">>(
      "SELECT o.id,o.number,o.request_id as requestId,o.session_id as sessionId,o.user_id as userId,COALESCE(u.name,'Histórico anterior') as userName,s.table_id as tableId,o.created_at as createdAt,o.notes,o.status FROM service_orders o JOIN table_sessions s ON s.id=o.session_id LEFT JOIN users u ON u.id=o.user_id WHERE o.id=?",
      id,
    );
    if (!row) throw new HttpError(404, "Pedido não encontrado.");
    return {
      ...row,
      items: this.db.all<PremiumOrderItem>(
        "SELECT id,product_id as productId,name,quantity,cancelled_quantity as cancelledQuantity,price_cents as priceCents FROM order_items WHERE order_id=? ORDER BY rowid",
        id,
      ),
    };
  }
  assertOwner(user: User, order: PremiumOrder) {
    if (user.role === "waiter" && order.userId !== user.id)
      throw new HttpError(403, "Você pode consultar somente seus pedidos.");
  }
  createOrder(user: User, input: CreateOrder & { sessionId: string }) {
    const payload = {
      ...input,
      items: [...input.items].sort((a, b) => a.productId - b.productId),
    };
    return this.db.operation(user.id, input.requestId, "order.create", payload, () => {
      const table = this.tables().find((t) => t.id === input.tableId);
      if (!table) throw new HttpError(400, "Mesa inválida.");
      if (!table?.sessionId)
        throw new HttpError(409, "Abra a mesa antes de enviar o pedido.");
      if (table.sessionId !== input.sessionId)
        throw new HttpError(
          409,
          "Este rascunho pertence a um atendimento anterior. Abra a mesa atual e revise o pedido.",
        );
      const session = this.requireOpen(table.sessionId);
      if (session.status !== "open")
        throw new HttpError(
          409,
          "Mesa aguardando pagamento. Conclua o atendimento antes de novos pedidos.",
        );
      const products = this.products(true);
      const id = randomUUID();
      this.db.run(
        "INSERT INTO service_orders(id,request_id,session_id,user_id,created_at,notes,status) VALUES(?,?,?,?,?,?,'received')",
        id,
        input.requestId,
        session.id,
        user.id,
        now(),
        input.notes,
      );
      for (const item of payload.items) {
        const p = products.find((p) => p.id === item.productId);
        if (!p || !p.active || !p.available)
          throw new HttpError(
            400,
            "Um produto não está mais disponível. Revise o pedido.",
          );
        this.db.run(
          "INSERT INTO order_items(id,order_id,product_id,name,quantity,price_cents) VALUES(?,?,?,?,?,?)",
          randomUUID(),
          id,
          p.id,
          p.name,
          item.quantity,
          p.priceCents,
        );
      }
      const order = this.order(id);
      const total = this.bill(session.id).totalCents;
      if (!Number.isSafeInteger(total) || total > 1_000_000_000_000)
        throw new HttpError(409, "Limite de valor por atendimento excedido.");
      this.printer.enqueue(
        order,
        "order",
        order.items.map((i) => ({ name: i.name, quantity: i.quantity })),
        null,
      );
      this.db.audit(user.id, "order.created", id, {
        number: order.number,
        sessionId: session.id,
      });
      return order;
    });
  }
  orderStatus(user: User, id: string, status: OrderStatus) {
    return this.db.tx(() => {
      const order = this.order(id);
      const allowed: Partial<Record<OrderStatus, OrderStatus>> = {
        received: "preparing",
        preparing: "ready",
        ready: "delivered",
      };
      if (order.status === status) return order;
      if (allowed[order.status] !== status)
        throw new HttpError(409, "Transição de preparo inválida.");
      this.db.run("UPDATE service_orders SET status=? WHERE id=?", status, id);
      this.db.audit(user.id, "order.status", id, { before: order.status, after: status });
      return this.order(id);
    });
  }
  bill(id: string): Bill {
    const s = this.session(id);
    const orders = this.db
      .all<{ id: string }>(
        "SELECT id FROM service_orders WHERE session_id=? ORDER BY number",
        id,
      )
      .map((o) => this.order(o.id));
    const subtotalCents = orders.reduce(
      (sum, o) =>
        sum +
        o.items.reduce(
          (n, i) => n + (i.quantity - i.cancelledQuantity) * i.priceCents,
          0,
        ),
      0,
    );
    const payments = this.db.all<Payment>(
      "SELECT p.id,p.method,p.amount_cents as amountCents,p.tendered_cents as tenderedCents,p.tendered_cents-p.amount_cents as changeCents,p.created_at as createdAt,u.name as userName,COALESCE((SELECT SUM(r.amount_cents) FROM refunds r WHERE r.payment_id=p.id),0) as refundedCents FROM payments p JOIN users u ON u.id=p.user_id WHERE p.session_id=? ORDER BY p.created_at",
      id,
    );
    const totalCents = subtotalCents - s.discount_cents + s.service_cents,
      paidCents = payments.reduce((sum, p) => sum + p.amountCents - p.refundedCents, 0);
    return {
      id: s.id,
      tableId: s.table_id,
      openedAt: s.opened_at,
      closedAt: s.closed_at,
      status: s.status,
      orders,
      payments,
      subtotalCents,
      discountCents: s.discount_cents,
      serviceCents: s.service_cents,
      waivedCents: s.waived_cents,
      totalCents,
      paidCents,
      balanceCents: totalCents - paidCents - s.waived_cents,
    };
  }
  bills(): Bill[] {
    return this.db
      .all<{ id: string }>("SELECT id FROM table_sessions ORDER BY opened_at DESC")
      .map((s) => this.bill(s.id));
  }
  requestClose(user: User, id: string) {
    return this.db.tx(() => {
      const s = this.requireOpen(id);
      this.db.run("UPDATE table_sessions SET status='awaiting_payment' WHERE id=?", id);
      this.db.run(
        "UPDATE dining_tables SET status='awaiting_payment' WHERE id=?",
        s.table_id,
      );
      this.db.audit(user.id, "table.close_requested", id, {});
      return this.bill(id);
    });
  }
  audit(): AuditEntry[] {
    return this.db.all<AuditEntry>(
      "SELECT a.id,COALESCE(u.name,'Sistema') as userName,a.action,a.entity_id as entityId,a.detail,a.created_at as createdAt FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 1000",
    );
  }
  dashboard(): Dashboard {
    const tables = this.tables(),
      orders = this.listOrders();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const received = this.db.get<{ n: number }>(
      "SELECT COALESCE(SUM(amount_cents),0) n FROM payments WHERE created_at>=? AND created_at<?",
      start.toISOString(),
      end.toISOString(),
    )!.n;
    const refunded = this.db.get<{ n: number }>(
      "SELECT COALESCE(SUM(amount_cents),0) n FROM refunds WHERE created_at>=? AND created_at<?",
      start.toISOString(),
      end.toISOString(),
    )!.n;
    return {
      totalTables: tables.length,
      availableTables: tables.filter((t) => t.status === "available").length,
      occupiedTables: tables.filter((t) => t.status === "occupied").length,
      awaitingPayment: tables.filter((t) => t.status === "awaiting_payment").length,
      preparingOrders: orders.filter(
        (o) => o.status === "received" || o.status === "preparing",
      ).length,
      readyOrders: orders.filter((o) => o.status === "ready").length,
      revenueTodayCents: received - refunded,
      cancelledOrders: orders.filter((o) => o.status === "cancelled").length,
      pendingCancellations: this.db.get<{ n: number }>(
        "SELECT COUNT(*) n FROM cancellation_requests WHERE status='pending'",
      )!.n,
      pendingPrintJobs: this.db.get<{ n: number }>(
        "SELECT COUNT(*) n FROM print_jobs WHERE status IN ('pending','failed')",
      )!.n,
      recent: this.audit().slice(0, 12),
    };
  }
}
