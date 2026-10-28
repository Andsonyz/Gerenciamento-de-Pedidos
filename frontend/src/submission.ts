import type { CreateOrder } from "@restaurante/shared";
const STORAGE_PREFIX = "mesa.pending-order.v1.";
export function createRequestId(): string {
  // getRandomValues is available on HTTP LAN, where randomUUID may be unavailable.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function readPending(): CreateOrder | null {
  // Separate keys prevent one tab from overwriting or clearing another tab's request.
  const key = Object.keys(localStorage)
    .filter((key) => key.startsWith(STORAGE_PREFIX))
    .sort()[0];
  const raw = key ? localStorage.getItem(key) : null;
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (
    !value ||
    typeof value !== "object" ||
    !("requestId" in value) ||
    typeof value.requestId !== "string" ||
    !("tableId" in value) ||
    typeof value.tableId !== "number" ||
    !("notes" in value) ||
    typeof value.notes !== "string" ||
    !("items" in value) ||
    !Array.isArray(value.items) ||
    !value.items.every(
      (item) =>
        typeof item.productId === "number" && typeof item.quantity === "number",
    )
  ) {
    throw new Error(
      "Envio salvo inválido. Consulte a impressora antes de limpar os dados deste navegador.",
    );
  }
  return value as CreateOrder;
}
export function savePending(order: CreateOrder): void {
  localStorage.setItem(
    `${STORAGE_PREFIX}${order.requestId}`,
    JSON.stringify(order),
  );
}
export function clearPending(requestId: string): void {
  localStorage.removeItem(`${STORAGE_PREFIX}${requestId}`);
}
