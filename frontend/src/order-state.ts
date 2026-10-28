import type { Order } from "@restaurante/shared";
export function normalizeOrders(orders: Order[]): Order[] {
  return [...new Map(orders.map((order) => [order.id, order])).values()].sort(
    (a, b) => b.number - a.number,
  );
}
export function mergeOrder(orders: Order[], order: Order): Order[] {
  return normalizeOrders([
    ...orders.filter((value) => value.id !== order.id),
    order,
  ]);
}
