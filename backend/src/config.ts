import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const root = fileURLToPath(new URL("../../", import.meta.url));
const envFile = resolve(root, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
export const dbPath = process.env.DATABASE_PATH
  ? resolve(process.env.DATABASE_PATH)
  : fileURLToPath(new URL("../data/restaurant.sqlite", import.meta.url));
export function tlsOptions() {
  if (!process.env.TLS_KEY && !process.env.TLS_CERT) return undefined;
  if (!process.env.TLS_KEY || !process.env.TLS_CERT)
    throw new Error("Informe TLS_KEY e TLS_CERT juntos.");
  return {
    key: readFileSync(resolve(process.env.TLS_KEY)),
    cert: readFileSync(resolve(process.env.TLS_CERT)),
  };
}
