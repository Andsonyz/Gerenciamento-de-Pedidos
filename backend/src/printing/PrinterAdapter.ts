import type { Order } from "@restaurante/shared";
import type { PremiumOrder, PrintJob, User } from "@restaurante/shared";
/** Future EscPosPrinterAdapter implements this contract with its own delivery policy. */
export interface PrinterAdapter<T = Order> {
  publish(order: T): void;
}
/** Persistent jobs are transport-independent; an ESC/POS implementation can replace delivery. */
export interface PrintQueueAdapter extends PrinterAdapter<PrintJob> {
  enqueue(
    order: PremiumOrder,
    type: "order" | "cancellation",
    items: { name: string; quantity: number }[],
    reason: string | null,
  ): PrintJob;
  cancelPendingProduction(orderId: string): void;
  list(): PrintJob[];
  get(id: string): PrintJob;
  update(user: User, id: string, status: "displayed" | "failed"): PrintJob;
  reprint(
    user: User,
    id: string,
    input: { requestId: string; reason: string },
  ): { value: PrintJob; created: boolean };
}
