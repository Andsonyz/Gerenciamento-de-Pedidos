import { randomUUID } from "node:crypto";
import type {
  CancellationInput,
  CancellationRequest,
  PremiumOrder,
  User,
} from "@restaurante/shared";
import { now } from "../database/store.js";
import { HttpError } from "../errors.js";
import { Restaurant } from "./restaurant.js";

export class Cancellations {
  constructor(private r: Restaurant) {}
  list(user: User): CancellationRequest[] {
    return this.r.db
      .all<{ id: string }>(
        `SELECT id FROM cancellation_requests ${user.role === "waiter" ? "WHERE user_id=?" : ""} ORDER BY created_at DESC`,
        ...(user.role === "waiter" ? [user.id] : []),
      )
      .map((x) => this.get(x.id));
  }
  get(id: string): CancellationRequest {
    const row = this.r.db.get<Omit<CancellationRequest, "items"> & { items: string }>(
      "SELECT c.id,c.order_id as orderId,o.number as orderNumber,s.table_id as tableId,c.user_id as userId,u.name as userName,c.reason,c.items,c.status,c.resolution_reason as resolutionReason,c.created_at as createdAt FROM cancellation_requests c JOIN service_orders o ON o.id=c.order_id JOIN table_sessions s ON s.id=o.session_id JOIN users u ON u.id=c.user_id WHERE c.id=?",
      id,
    );
    if (!row) throw new HttpError(404, "Solicitação não encontrada.");
    return { ...row, items: JSON.parse(row.items) as CancellationRequest["items"] };
  }
  validate(
    order: PremiumOrder,
    input: CancellationInput,
    requireAcknowledgement: boolean,
  ) {
    this.r.requireOpen(order.sessionId);
    if (this.r.bill(order.sessionId).paidCents > 0)
      throw new HttpError(
        409,
        "Há pagamentos registrados. O administrador deve registrar estorno separado antes de cancelar.",
      );
    if (
      requireAcknowledgement &&
      ["preparing", "ready"].includes(order.status) &&
      !input.acknowledged
    )
      throw new HttpError(
        409,
        `Pedido ${order.status === "ready" ? "pronto" : "em preparo"}. Confirme ciência do estado antes de cancelar.`,
      );
    return input.items.map((item) => {
      const original = order.items.find((i) => i.id === item.itemId);
      if (!original || item.quantity > original.quantity - original.cancelledQuantity)
        throw new HttpError(409, "Quantidade de cancelamento excede o saldo do item.");
      return { ...item, name: original.name };
    });
  }
  request(user: User, id: string, input: CancellationInput) {
    return this.r.db.operation(
      user.id,
      input.requestId,
      "cancellation.request",
      { orderId: id, ...input },
      () => {
        const order = this.r.order(id);
        this.r.assertOwner(user, order);
        const items = this.validate(order, input, false);
        if (
          this.r.db.get(
            "SELECT id FROM cancellation_requests WHERE order_id=? AND status='pending'",
            id,
          )
        )
          throw new HttpError(
            409,
            "Já existe uma solicitação pendente para este pedido.",
          );
        const requestId = randomUUID();
        this.r.db.run(
          "INSERT INTO cancellation_requests(id,order_id,user_id,reason,items,status,created_at) VALUES(?,?,?,?,?,'pending',?)",
          requestId,
          id,
          user.id,
          input.reason,
          JSON.stringify(items),
          now(),
        );
        this.r.db.audit(user.id, "cancellation.requested", id, {
          requestId,
          items,
          reason: input.reason,
        });
        return this.get(requestId);
      },
    );
  }
  private apply(user: User, id: string, input: CancellationInput) {
    const order = this.r.order(id),
      items = this.validate(order, input, true),
      before = this.r.bill(order.sessionId);
    const cancelledValue = items.reduce(
      (sum, i) =>
        sum + i.quantity * order.items.find((x) => x.id === i.itemId)!.priceCents,
      0,
    );
    if (before.discountCents > before.subtotalCents - cancelledValue)
      throw new HttpError(409, "Ajuste o desconto da conta antes deste cancelamento.");
    for (const item of items)
      this.r.db.run(
        "UPDATE order_items SET cancelled_quantity=cancelled_quantity+? WHERE id=?",
        item.quantity,
        item.itemId,
      );
    const remaining = this.r
      .order(id)
      .items.some((i) => i.quantity > i.cancelledQuantity);
    const newState = remaining ? order.status : "cancelled";
    this.r.db.run("UPDATE service_orders SET status=? WHERE id=?", newState, id);
    for (const item of items)
      this.r.db.run(
        "INSERT INTO cancellations VALUES(?,?,?,?,?,?,?,?,?)",
        randomUUID(),
        id,
        item.itemId,
        item.quantity,
        input.reason,
        user.id,
        now(),
        order.status,
        newState,
      );
    if (!remaining) this.r.printer.cancelPendingProduction(id);
    this.r.printer.enqueue(
      order,
      "cancellation",
      items.map((i) => ({ name: i.name, quantity: i.quantity })),
      input.reason,
    );
    this.r.db.audit(user.id, "order.cancelled", id, {
      items,
      reason: input.reason,
      before: order.status,
      after: newState,
    });
    return this.r.order(id);
  }
  cancel(user: User, id: string, input: CancellationInput) {
    return this.r.db.operation(
      user.id,
      input.requestId,
      "cancellation.direct",
      { orderId: id, ...input },
      () => {
        if (
          this.r.db.get(
            "SELECT id FROM cancellation_requests WHERE order_id=? AND status='pending'",
            id,
          )
        )
          throw new HttpError(
            409,
            "Resolva a solicitação pendente antes de cancelar diretamente.",
          );
        return this.apply(user, id, input);
      },
    );
  }
  resolve(
    user: User,
    id: string,
    input: { approve: boolean; reason: string; acknowledged?: boolean },
  ) {
    return this.r.db.tx(() => {
      const request = this.get(id);
      if (request.status !== "pending") {
        if (
          request.status === (input.approve ? "approved" : "rejected") &&
          request.resolutionReason === input.reason
        )
          return request;
        throw new HttpError(409, "Solicitação já resolvida.");
      }
      if (input.approve)
        this.apply(user, request.orderId, {
          requestId: id,
          reason: request.reason + " · Aprovação: " + input.reason,
          items: request.items.map((i) => ({ itemId: i.itemId, quantity: i.quantity })),
          acknowledged: input.acknowledged,
        });
      this.r.db.run(
        "UPDATE cancellation_requests SET status=?,resolution_reason=?,resolved_by=?,resolved_at=? WHERE id=?",
        input.approve ? "approved" : "rejected",
        input.reason,
        user.id,
        now(),
        id,
      );
      this.r.db.audit(user.id, "cancellation.resolved", id, input);
      return this.get(id);
    });
  }
}
