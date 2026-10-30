export * from "./premium.js";
export interface Table {
  id: number;
  name: string;
}
export interface Product {
  id: number;
  name: string;
  category: string;
  priceCents: number;
}
export interface CreateOrder {
  /** Required by the authenticated API; optional only for importing legacy MVP data. */
  sessionId?: string;
  requestId: string;
  tableId: number;
  items: { productId: number; quantity: number }[];
  notes: string;
}
export interface OrderItem {
  productId: number;
  name: string;
  quantity: number;
  priceCents: number;
}
export interface Order {
  id: string;
  number: number;
  requestId: string;
  tableId: number;
  createdAt: string;
  notes: string;
  status: "pending" | "viewed";
  items: OrderItem[];
}
export interface ServerEvents {
  "orders:snapshot": (orders: Order[]) => void;
  "order:upsert": (order: Order) => void;
}
export interface ClientEvents {
  "orders:sync": () => void;
}
