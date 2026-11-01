import type { Notifications, TableAttention, User } from "@restaurante/shared";
import { Store } from "../database/store.js";
import { HttpError } from "../errors.js";

export class TableNotifications {
  constructor(private db: Store) {}
  list(): Notifications {
    const rows = this.db.all<{
      id: string;
      tableId: number;
      tableName: string;
      status: string;
      openedAt: string;
      requestedAt: string | null;
      acknowledgedAt: string | null;
      closingAt: string | null;
      valid: number;
      pending: number;
      ready: number;
      lastOrderAt: string | null;
    }>(`
    SELECT s.id,t.id as tableId,t.name as tableName,s.status,s.opened_at as openedAt,
      a.requested_at as requestedAt,a.acknowledged_at as acknowledgedAt,a.closing_at as closingAt,
      (SELECT COUNT(*) FROM service_orders o JOIN order_items i ON i.order_id=o.id WHERE o.session_id=s.id AND i.quantity>i.cancelled_quantity) as valid,
      (SELECT COUNT(*) FROM service_orders o WHERE o.session_id=s.id AND o.status IN ('received','preparing','ready')) as pending,
      (SELECT COUNT(*) FROM service_orders o WHERE o.session_id=s.id AND o.status='ready') as ready,
      (SELECT MAX(created_at) FROM service_orders o WHERE o.session_id=s.id) as lastOrderAt
    FROM table_sessions s JOIN dining_tables t ON t.id=s.table_id
    LEFT JOIN table_service_state a ON a.session_id=s.id WHERE s.status!='closed' ORDER BY t.id`);
    const items: TableAttention[] = [];
    for (const row of rows) {
      const type =
        row.status === "awaiting_payment"
          ? "closing"
          : (row.requestedAt && !row.acknowledgedAt) ||
              (!row.valid && !row.acknowledgedAt)
            ? "waiter"
            : !row.valid || row.pending
              ? "order"
              : null;
      if (!type) continue;
      items.push({
        id: `${row.id}:${type}`,
        sessionId: row.id,
        tableId: row.tableId,
        tableName: row.tableName,
        type,
        detail:
          type === "closing"
            ? "Cliente aguarda pagamento e encerramento da conta."
            : type === "waiter"
              ? "Mesa ocupada aguardando atendimento do garçom."
              : !row.valid
                ? "Garçom atendeu; aguardando registro do pedido."
                : row.ready
                  ? "Pedido pronto para servir."
                  : "Pedido recebido ou em preparo na cozinha.",
        createdAt:
          (type === "closing"
            ? row.closingAt
            : type === "waiter"
              ? row.requestedAt
              : row.lastOrderAt) || row.openedAt,
      });
    }
    return {
      items,
      counts: {
        waiter: items.filter((i) => i.type === "waiter").length,
        order: items.filter((i) => i.type === "order").length,
        closing: items.filter((i) => i.type === "closing").length,
        total: items.length,
      },
    };
  }
  private active(tableId: number) {
    const session = this.db.get<{ id: string; status: string; opened_at: string }>(
      "SELECT id,status,opened_at FROM table_sessions WHERE table_id=? AND status!='closed'",
      tableId,
    );
    if (!session || session.status !== "open")
      throw new HttpError(
        409,
        "Abra um atendimento antes de chamar ou atender o garçom. Mesas em fechamento devem ser tratadas pelo caixa.",
      );
    return session;
  }
  call(user: User, tableId: number, requestId: string) {
    return this.db.operation(user.id, requestId, "table.call-waiter", { tableId }, () => {
      const session = this.active(tableId);
      const pending = this.db.get(
        "SELECT session_id FROM table_service_state WHERE session_id=? AND acknowledged_at IS NULL",
        session.id,
      );
      if (!pending) {
        this.db.run(
          "INSERT INTO table_service_state(session_id,requested_at,requested_by) VALUES(?,?,?) ON CONFLICT(session_id) DO UPDATE SET requested_at=excluded.requested_at,requested_by=excluded.requested_by,acknowledged_at=NULL,acknowledged_by=NULL",
          session.id,
          this.db.timestamp(),
          user.id,
        );
        this.db.audit(user.id, "table.waiter-called", session.id, { tableId });
      }
      return { ok: true };
    });
  }
  acknowledge(user: User, tableId: number, requestId: string) {
    return this.db.operation(
      user.id,
      requestId,
      "table.acknowledge-call",
      { tableId },
      () => {
        const session = this.active(tableId);
        this.completeCall(user, session.id);
        return { ok: true };
      },
    );
  }
  completeCall(user: User, sessionId: string) {
    const prior = this.db.get<{ acknowledged_at: string | null }>(
      "SELECT acknowledged_at FROM table_service_state WHERE session_id=?",
      sessionId,
    );
    if (prior?.acknowledged_at) return;
    this.db.run(
      "INSERT INTO table_service_state(session_id,requested_at,acknowledged_at,acknowledged_by) VALUES(?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET acknowledged_at=excluded.acknowledged_at,acknowledged_by=excluded.acknowledged_by",
      sessionId,
      this.db.timestamp(),
      this.db.timestamp(),
      user.id,
    );
    this.db.audit(user.id, "table.waiter-attended", sessionId, {});
  }
  closing(user: User, sessionId: string) {
    this.db.run(
      "INSERT INTO table_service_state(session_id,requested_at,closing_at,requested_by) VALUES(?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET closing_at=COALESCE(table_service_state.closing_at,excluded.closing_at)",
      sessionId,
      this.db.timestamp(),
      this.db.timestamp(),
      user.id,
    );
  }
}
