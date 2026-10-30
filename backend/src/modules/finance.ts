import { randomUUID } from "node:crypto";
import type { PaymentMethod, User } from "@restaurante/shared";
import { now } from "../database/store.js";
import { HttpError } from "../errors.js";
import { Restaurant } from "./restaurant.js";

export class Finance {
  constructor(private r: Restaurant) {}
  adjustments(
    user: User,
    id: string,
    input: { discountCents: number; serviceCents: number; reason: string },
  ) {
    return this.r.db.tx(() => {
      this.r.requireOpen(id);
      const before = this.r.bill(id);
      if (before.paidCents > 0)
        throw new HttpError(409, "Estorne os pagamentos antes de ajustar valores.");
      if (input.discountCents > before.subtotalCents)
        throw new HttpError(400, "Desconto excede o subtotal.");
      this.r.db.run(
        "UPDATE table_sessions SET discount_cents=?,service_cents=? WHERE id=?",
        input.discountCents,
        input.serviceCents,
        id,
      );
      this.r.db.audit(user.id, "bill.adjusted", id, {
        before: {
          discountCents: before.discountCents,
          serviceCents: before.serviceCents,
        },
        ...input,
      });
      return this.r.bill(id);
    });
  }
  pay(
    user: User,
    id: string,
    input: {
      requestId: string;
      method: PaymentMethod;
      amountCents: number;
      tenderedCents?: number;
    },
  ) {
    return this.r.db.operation(
      user.id,
      input.requestId,
      "payment.create",
      { sessionId: id, ...input },
      () => {
        this.r.requireOpen(id);
        const bill = this.r.bill(id);
        if (
          this.r.db.get(
            "SELECT c.id FROM cancellation_requests c JOIN service_orders o ON o.id=c.order_id WHERE o.session_id=? AND c.status='pending'",
            id,
          )
        )
          throw new HttpError(
            409,
            "Resolva as solicitações de cancelamento antes do pagamento.",
          );
        if (input.amountCents > bill.balanceCents)
          throw new HttpError(409, "Pagamento excede o saldo pendente.");
        if (input.method === "other" && !this.r.settings().otherPaymentEnabled)
          throw new HttpError(400, "Forma de pagamento não habilitada.");
        const tendered = input.tenderedCents ?? input.amountCents;
        if (
          tendered < input.amountCents ||
          (input.method !== "cash" && tendered !== input.amountCents)
        )
          throw new HttpError(
            400,
            "Valor recebido inválido para esta forma de pagamento.",
          );
        const paymentId = randomUUID();
        this.r.db.run(
          "INSERT INTO payments VALUES(?,?,?,?,?,?,?)",
          paymentId,
          id,
          user.id,
          input.method,
          input.amountCents,
          tendered,
          now(),
        );
        this.r.db.run(
          "UPDATE table_sessions SET status='awaiting_payment' WHERE id=?",
          id,
        );
        this.r.db.run(
          "UPDATE dining_tables SET status='awaiting_payment' WHERE id=?",
          bill.tableId,
        );
        this.r.db.audit(user.id, "payment.registered", paymentId, {
          sessionId: id,
          method: input.method,
          amountCents: input.amountCents,
          tenderedCents: tendered,
          changeCents: tendered - input.amountCents,
        });
        return this.r.bill(id);
      },
    );
  }
  refund(
    user: User,
    id: string,
    input: { requestId: string; amountCents: number; reason: string },
  ) {
    return this.r.db.operation(
      user.id,
      input.requestId,
      "payment.refund",
      { paymentId: id, ...input },
      () => {
        const payment = this.r.db.get<{ session_id: string; amount_cents: number }>(
          "SELECT * FROM payments WHERE id=?",
          id,
        );
        if (!payment) throw new HttpError(404, "Pagamento não encontrado.");
        this.r.requireOpen(payment.session_id);
        const prior = this.r.db.get<{ n: number }>(
          "SELECT COALESCE(SUM(amount_cents),0) n FROM refunds WHERE payment_id=?",
          id,
        )!.n;
        if (input.amountCents > payment.amount_cents - prior)
          throw new HttpError(409, "Estorno excede o pagamento disponível.");
        this.r.db.run(
          "INSERT INTO refunds VALUES(?,?,?,?,?,?)",
          randomUUID(),
          id,
          user.id,
          input.amountCents,
          input.reason,
          now(),
        );
        this.r.db.audit(user.id, "payment.refunded", id, {
          amountCents: input.amountCents,
          reason: input.reason,
        });
        return this.r.bill(payment.session_id);
      },
    );
  }
  close(
    user: User,
    id: string,
    input: { requestId: string; exceptional?: boolean; reason?: string },
  ) {
    return this.r.db.operation(
      user.id,
      input.requestId,
      "session.close",
      { sessionId: id, ...input },
      () => {
        this.r.requireOpen(id);
        const bill = this.r.bill(id);
        if (
          this.r.db.get(
            "SELECT c.id FROM cancellation_requests c JOIN service_orders o ON o.id=c.order_id WHERE o.session_id=? AND c.status='pending'",
            id,
          )
        )
          throw new HttpError(
            409,
            "Resolva as solicitações de cancelamento antes de encerrar.",
          );
        if (bill.balanceCents !== 0) {
          if (!input.exceptional || user.role !== "admin" || !input.reason?.trim())
            throw new HttpError(409, "A mesa possui saldo pendente.");
          if (bill.balanceCents < 0)
            throw new HttpError(409, "Revise o saldo antes de encerrar.");
          this.r.db.run(
            "UPDATE table_sessions SET waived_cents=? WHERE id=?",
            bill.balanceCents,
            id,
          );
        }
        this.r.db.run(
          "UPDATE table_sessions SET status='closed',closed_at=? WHERE id=?",
          now(),
          id,
        );
        this.r.db.run(
          "UPDATE dining_tables SET status='available' WHERE id=?",
          bill.tableId,
        );
        this.r.db.audit(user.id, "session.closed", id, {
          exceptional: !!input.exceptional,
          reason: input.reason ?? null,
          waivedCents: bill.balanceCents,
        });
        return this.r.bill(id);
      },
    );
  }
}
