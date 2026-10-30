import { randomUUID } from "node:crypto";
import type { PremiumOrder, PrintJob, User } from "@restaurante/shared";
import type { PrintQueueAdapter } from "./PrinterAdapter.js";
import { Store, now } from "../database/store.js";
import { HttpError } from "../errors.js";

export class VirtualPrinterAdapter implements PrintQueueAdapter {
  constructor(
    private db: Store,
    private notify: (job: PrintJob) => void = () => {},
  ) {}
  publish(job: PrintJob) {
    this.notify(job);
  }
  private isCancellation(job: PrintJob): boolean {
    const seen = new Set<string>();
    let current: PrintJob | undefined = job;
    while (current && !seen.has(current.id)) {
      if (current.type === "cancellation") return true;
      seen.add(current.id);
      current = current.sourceJobId ? this.get(current.sourceJobId) : undefined;
    }
    return false;
  }
  cancelPendingProduction(orderId: string) {
    for (const job of this.list().filter(
      (j) => j.orderId === orderId && ["pending", "failed"].includes(j.status),
    )) {
      if (!this.isCancellation(job))
        this.db.run("UPDATE print_jobs SET status='cancelled' WHERE id=?", job.id);
    }
  }
  // Called inside the order/cancellation transaction; no network side effect before commit.
  enqueue(
    order: PremiumOrder,
    type: "order" | "cancellation",
    items: { name: string; quantity: number }[],
    reason: string | null,
  ) {
    const id = randomUUID();
    this.db.run(
      "INSERT INTO print_jobs(id,order_id,type,status,created_at,payload) VALUES(?,?,?,'pending',?,?)",
      id,
      order.id,
      type,
      now(),
      JSON.stringify({ items, notes: order.notes, reason }),
    );
    return this.get(id);
  }
  list(): PrintJob[] {
    return this.db
      .all<{ id: string }>(
        "SELECT id FROM print_jobs ORDER BY created_at DESC,rowid DESC",
      )
      .map((r) => this.get(r.id));
  }
  get(id: string): PrintJob {
    const r = this.db.get<
      Omit<PrintJob, "notes" | "reason" | "items"> & { payload: string }
    >(
      "SELECT j.id,j.order_id as orderId,o.number as orderNumber,s.table_id as tableId,j.type,j.status,j.created_at as createdAt,j.displayed_at as displayedAt,j.source_job_id as sourceJobId,o.status as orderStatus,j.payload FROM print_jobs j JOIN service_orders o ON o.id=j.order_id JOIN table_sessions s ON s.id=o.session_id WHERE j.id=?",
      id,
    );
    if (!r) throw new HttpError(404, "Comanda não encontrada.");
    const { payload, ...row } = r;
    return {
      ...row,
      ...(JSON.parse(payload) as Pick<PrintJob, "notes" | "reason" | "items">),
    };
  }
  update(user: User, id: string, status: "displayed" | "failed") {
    return this.db.tx(() => {
      const job = this.get(id);
      if (job.status === "cancelled") throw new HttpError(409, "Trabalho cancelado.");
      if (job.status === status) return job;
      if (job.status === "displayed")
        throw new HttpError(409, "Comanda já exibida. Use reimpressão simulada.");
      this.db.run(
        "UPDATE print_jobs SET status=?,displayed_at=? WHERE id=?",
        status,
        status === "displayed" ? now() : null,
        id,
      );
      this.db.audit(user.id, "print.updated", id, { before: job.status, after: status });
      return this.get(id);
    });
  }
  reprint(user: User, id: string, input: { requestId: string; reason: string }) {
    return this.db.operation(
      user.id,
      input.requestId,
      "print.reprint",
      { jobId: id, ...input },
      () => {
        const source = this.get(id),
          jobId = randomUUID(),
          cancellation = this.isCancellation(source);
        if (source.orderStatus === "cancelled" && !cancellation)
          throw new HttpError(
            409,
            "Pedido cancelado. Reimprima somente o aviso de cancelamento.",
          );
        const reason = `${cancellation ? "CANCELAMENTO · " : ""}Reimpressão simulada: ${input.reason}${source.reason ? " · " + source.reason : ""}`;
        this.db.run(
          "INSERT INTO print_jobs(id,order_id,type,status,created_at,source_job_id,payload) VALUES(?,?,'reprint','pending',?,?,?)",
          jobId,
          source.orderId,
          now(),
          id,
          JSON.stringify({ items: source.items, notes: source.notes, reason }),
        );
        this.db.audit(user.id, "print.reprinted", jobId, {
          sourceJobId: id,
          reason: input.reason,
        });
        return this.get(jobId);
      },
    );
  }
}
