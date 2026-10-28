import type { CreateOrder, Order } from "@restaurante/shared";
import type { OrderDatabase } from "./database.js";
import type { PrinterAdapter } from "./printing/PrinterAdapter.js";
export class OrderService {
  constructor(
    private readonly database: OrderDatabase,
    private readonly printer: PrinterAdapter,
  ) {}
  private notify(order: Order): void {
    // A transport failure cannot undo a committed order. Reconnection reads the database.
    try {
      this.printer.publish(order);
    } catch (error) {
      console.error("Falha ao notificar impressora; pedido preservado.", error);
    }
  }
  create(input: CreateOrder) {
    const result = this.database.create(input);
    if (result.created) this.notify(result.order);
    return result;
  }
  markViewed(id: string): Order {
    const order = this.database.markViewed(id);
    this.notify(order);
    return order;
  }
}
