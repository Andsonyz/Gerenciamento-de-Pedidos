import type { Ingredient } from "./operations.js";
export interface AnalyticsReport {
  from: string;
  to: string;
  timeZone: string;
  ranking: {
    productId: number;
    name: string;
    ordered: number;
    cancelled: number;
    valid: number;
    valueCents: number;
  }[];
  paymentsCents: number;
  refundedCents: number;
  stock: Ingredient[];
  consumption: {
    ingredientId: string;
    name: string;
    unit: string;
    consumed: number;
    wasted: number;
  }[];
  purchases: { confirmedCents: number; receivedCents: number; pendingCount: number };
  replenishment: {
    ingredientId: string;
    name: string;
    unit: string;
    available: number;
    minimum: number;
    incoming: number;
    averageDaily: number;
    observedDays: number;
    suggested: number;
    limitedHistory: boolean;
    preferredSupplierId: string | null;
  }[];
  coverage: { trackedProducts: number; totalProducts: number };
}
