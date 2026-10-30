import { createRequestId } from "./submission";
export interface PendingOperation {
  key: string;
  path: string;
  method: string;
  body: Record<string, unknown>;
  createdAt: string;
  tabId: string;
}
export type OperationStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;
const prefix = (id: string) => `mesa.operation.v3.${encodeURIComponent(id)}.`;
export function tabScope(): string {
  if (typeof sessionStorage === "undefined") return "test-tab";
  let id = sessionStorage.getItem("mesa.tab.v1");
  if (!id) {
    id = createRequestId();
    sessionStorage.setItem("mesa.tab.v1", id);
  }
  return id;
}
export function readOperations(
  id: string,
  storage: OperationStorage = localStorage,
): PendingOperation[] {
  const keys = Array.from({ length: storage.length }, (_, index) =>
    storage.key(index),
  ).filter((key): key is string => key !== null && key.startsWith(prefix(id)));
  return keys
    .map((key) => {
      try {
        const item: unknown = JSON.parse(storage.getItem(key) || "null");
        if (
          !item ||
          typeof item !== "object" ||
          !("key" in item) ||
          typeof item.key !== "string" ||
          !("path" in item) ||
          typeof item.path !== "string" ||
          !item.path.startsWith("/") ||
          item.path.startsWith("//") ||
          !("method" in item) ||
          typeof item.method !== "string" ||
          !("body" in item) ||
          !item.body ||
          typeof item.body !== "object" ||
          !("requestId" in item.body) ||
          typeof item.body.requestId !== "string" ||
          !("createdAt" in item) ||
          typeof item.createdAt !== "string" ||
          !("tabId" in item) ||
          typeof item.tabId !== "string"
        )
          throw new Error("invalid");
        return item as PendingOperation;
      } catch {
        throw new Error(
          "Os dados de operações pendentes estão inválidos. Preserve este navegador e peça à administração para conferir os pedidos antes de continuar.",
        );
      }
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
export function saveOperation(
  id: string,
  operation: PendingOperation,
  storage: OperationStorage = localStorage,
) {
  storage.setItem(
    `${prefix(id)}${String(operation.body.requestId)}`,
    JSON.stringify(operation),
  );
}
export function completeOperation(
  id: string,
  operation: PendingOperation,
  storage: OperationStorage = localStorage,
) {
  storage.removeItem(`${prefix(id)}${String(operation.body.requestId)}`);
}
export function getOperation(
  id: string,
  key: string,
  path: string,
  method: string,
  body: Record<string, unknown>,
  storage: OperationStorage = localStorage,
  tabId = tabScope(),
): PendingOperation {
  return (
    readOperations(id, storage).find(
      (item) => item.key === key && item.tabId === tabId,
    ) || {
      key,
      path,
      method,
      body: { ...body, requestId: createRequestId() },
      createdAt: new Date().toISOString(),
      tabId,
    }
  );
}
