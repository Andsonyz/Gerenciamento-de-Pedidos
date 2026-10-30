export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}
let csrfToken = "";
export function setCsrfToken(value: string) {
  csrfToken = value;
}
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`/api${path}`, {
      ...options,
      credentials: "include",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
        ...options?.headers,
      },
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        code?: string;
      } | null;
      throw new ApiError(
        body?.error ?? "O servidor não conseguiu concluir a operação.",
        response.status,
        body?.code,
      );
    }
    return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  } catch (cause) {
    if (cause instanceof ApiError) throw cause;
    throw new Error(
      cause instanceof DOMException && cause.name === "AbortError"
        ? "O servidor demorou para responder. Preserve a operação e tente consultar novamente."
        : "Não foi possível conectar ao servidor. Verifique a rede e tente novamente.",
    );
  } finally {
    window.clearTimeout(timeout);
  }
}
export const money = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100,
  );
export const tableName = (id: number) => `Mesa ${String(id).padStart(2, "0")}`;
export function parseCents(value: string): number {
  const normalized = value.trim().replace(/^R\$\s*/, "");
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(normalized))
    throw new Error("Informe um valor como 25,90, sem separador de milhares.");
  const [whole, fraction = ""] = normalized.replace(",", ".").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error("Valor fora do limite permitido.");
  return cents;
}
export const dateTime = (value: string) =>
  new Date(value).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
