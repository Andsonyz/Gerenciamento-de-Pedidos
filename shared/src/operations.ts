export type IngredientUnit = "g" | "ml" | "un";
export interface IngredientInput {
  name: string;
  unit: IngredientUnit;
  minimum: number;
  active: boolean;
  preferredSupplierId?: string | null;
}
export interface Ingredient extends IngredientInput {
  id: string;
  preferredSupplierId: string | null;
  trackingSince: string;
  physical: number;
  reserved: number;
  available: number;
}
export interface RecipeInput {
  active: boolean;
  items: { ingredientId: string; quantity: number }[];
}
export interface RecipeVersion {
  id: string;
  productId: number;
  version: number;
  active: boolean;
  createdAt: string;
  items: { ingredientId: string; name: string; unit: IngredientUnit; quantity: number }[];
}
export type InventoryMovementKind =
  | "initial"
  | "adjustment"
  | "loss"
  | "reserve"
  | "release"
  | "consume"
  | "waste"
  | "receipt";
export interface InventoryMovement {
  id: string;
  ingredientId: string;
  ingredientName: string;
  unit: IngredientUnit;
  kind: InventoryMovementKind;
  quantity: number;
  reservedDelta: number;
  wasteQuantity: number;
  reason: string;
  sourceId: string;
  userName: string;
  createdAt: string;
}
export interface InventoryAdjustment {
  requestId: string;
  ingredientId: string;
  quantity: number;
  kind: "initial" | "adjustment" | "loss";
  reason: string;
  overrideReason?: string;
}
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface SupplierInput {
  name: string;
  phone: string;
  email: string;
  active: boolean;
  ingredientIds: string[];
}
export interface Supplier extends SupplierInput {
  id: string;
  createdAt: string;
}
export type PurchaseStatus =
  "draft" | "confirmed" | "partially_received" | "received" | "cancelled";
export interface PurchaseInput {
  requestId: string;
  supplierId: string;
  notes: string;
  items: { ingredientId: string; quantity: number; totalCents: number }[];
}
export interface PurchaseItem {
  id: string;
  ingredientId: string;
  ingredientName: string;
  unit: IngredientUnit;
  quantity: number;
  totalCents: number;
  receivedQuantity: number;
  receivedCents: number;
}
export interface PurchaseReceipt {
  id: string;
  createdAt: string;
  userName: string;
  items: { itemId: string; quantity: number; totalCents: number }[];
}
export interface Purchase {
  id: string;
  supplierId: string;
  supplierName: string;
  notes: string;
  status: PurchaseStatus;
  createdAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  items: PurchaseItem[];
  receipts: PurchaseReceipt[];
  totalCents: number;
  receivedCents: number;
}
export interface PurchaseReceiveInput {
  requestId: string;
  items: { itemId: string; quantity: number }[];
}
