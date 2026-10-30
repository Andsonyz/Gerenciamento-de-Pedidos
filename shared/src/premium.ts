export type Role = "admin" | "cashier" | "waiter" | "kitchen";
export interface User {
  id: string;
  username: string;
  name: string;
  role: Role;
  active: boolean;
}
export interface UserInput {
  username: string;
  name: string;
  role: Role;
  active: boolean;
  password?: string;
}
export interface AuthSession {
  user: User;
  csrfToken: string;
  expiresAt: string;
}
export type TableStatus =
  "available" | "occupied" | "awaiting_payment" | "reserved" | "unavailable";
export interface DiningTable {
  id: number;
  name: string;
  status: TableStatus;
  sessionId: string | null;
}
export interface Category {
  id: number;
  name: string;
}
export interface CatalogProduct {
  id: number;
  name: string;
  category: string;
  priceCents: number;
  active: boolean;
  available: boolean;
}
export type OrderStatus = "received" | "preparing" | "ready" | "delivered" | "cancelled";
export interface PremiumOrderItem {
  id: string;
  productId: number;
  name: string;
  quantity: number;
  cancelledQuantity: number;
  priceCents: number;
}
export interface PremiumOrder {
  id: string;
  number: number;
  requestId: string;
  tableId: number;
  sessionId: string;
  userId: string | null;
  userName: string;
  createdAt: string;
  notes: string;
  status: OrderStatus;
  items: PremiumOrderItem[];
}
export interface CancellationInput {
  requestId: string;
  reason: string;
  items: { itemId: string; quantity: number }[];
  acknowledged?: boolean;
}
export interface CancellationRequest {
  id: string;
  orderId: string;
  orderNumber: number;
  tableId: number;
  userId: string;
  userName: string;
  reason: string;
  items: { itemId: string; name: string; quantity: number }[];
  status: "pending" | "approved" | "rejected";
  resolutionReason: string | null;
  createdAt: string;
}
export type PaymentMethod = "cash" | "pix" | "debit" | "credit" | "other";
export interface Payment {
  id: string;
  method: PaymentMethod;
  amountCents: number;
  tenderedCents: number;
  changeCents: number;
  refundedCents: number;
  createdAt: string;
  userName: string;
}
export interface Bill {
  id: string;
  tableId: number;
  openedAt: string;
  closedAt: string | null;
  status: "open" | "awaiting_payment" | "closed";
  orders: PremiumOrder[];
  payments: Payment[];
  subtotalCents: number;
  discountCents: number;
  serviceCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  waivedCents: number;
}
export interface PrintJob {
  id: string;
  orderId: string;
  orderNumber: number;
  tableId: number;
  type: "order" | "cancellation" | "reprint";
  status: "pending" | "displayed" | "failed" | "cancelled";
  createdAt: string;
  displayedAt: string | null;
  sourceJobId: string | null;
  notes: string;
  reason: string | null;
  orderStatus: OrderStatus;
  items: { name: string; quantity: number }[];
}
export interface AuditEntry {
  id: number;
  userName: string;
  action: string;
  entityId: string;
  detail: string;
  createdAt: string;
}
export interface Dashboard {
  totalTables: number;
  availableTables: number;
  occupiedTables: number;
  awaitingPayment: number;
  preparingOrders: number;
  readyOrders: number;
  revenueTodayCents: number;
  cancelledOrders: number;
  pendingCancellations: number;
  pendingPrintJobs: number;
  recent: AuditEntry[];
}
export interface RestaurantSettings {
  name: string;
  otherPaymentEnabled: boolean;
}
export interface StateChange {
  id: string;
  scope:
    | "tables"
    | "orders"
    | "payments"
    | "printing"
    | "catalog"
    | "cancellations"
    | "settings";
}
