export function originAllowed(
  origin: string | undefined,
  allowedOrigins?: string[],
): boolean {
  if (!origin) return true; // CLI/native clients do not send Origin.
  if (allowedOrigins) return allowedOrigins.includes(origin);
  try {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    const host = url.hostname;
    if (host === "localhost" || host === "[::1]") return true;
    const parts = host.split(".").map(Number);
    if (
      parts.length !== 4 ||
      parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    )
      return false;
    const [a, b] = parts;
    return (
      a === 127 ||
      a === 10 ||
      (a === 192 && b === 168) ||
      (a === 172 && b !== undefined && b >= 16 && b <= 31)
    );
  } catch {
    return false;
  }
}
