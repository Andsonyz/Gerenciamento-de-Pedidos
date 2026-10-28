import type { Server } from "socket.io";
import type { ClientEvents, Order, ServerEvents } from "@restaurante/shared";
import type { PrinterAdapter } from "./PrinterAdapter.js";
export class VirtualPrinterAdapter implements PrinterAdapter {
  constructor(
    private readonly io: Server<ClientEvents, ServerEvents>,
    readOrders: () => Order[],
  ) {
    io.on("connection", (socket) => {
      // Synchronous reads and emits keep snapshots ordered with subsequent mutations.
      const sync = () => socket.emit("orders:snapshot", readOrders());
      socket.on("orders:sync", sync);
      sync();
    });
  }
  publish(order: Order): void {
    this.io.emit("order:upsert", order);
  }
}
