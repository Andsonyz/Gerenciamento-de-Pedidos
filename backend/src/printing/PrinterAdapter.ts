import type { Order } from "@restaurante/shared";
/** Future EscPosPrinterAdapter implements this contract with its own delivery policy. */
export interface PrinterAdapter {
  publish(order: Order): void;
}
