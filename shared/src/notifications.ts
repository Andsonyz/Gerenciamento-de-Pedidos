export type AttentionType = "waiter" | "order" | "closing";
export interface TableAttention {
  id: string;
  tableId: number;
  tableName: string;
  sessionId: string;
  type: AttentionType;
  detail: string;
  createdAt: string;
}
export interface Notifications {
  items: TableAttention[];
  counts: Record<AttentionType, number> & { total: number };
}
