import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { createApplication } from "./app.js";

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT deve ser uma porta entre 1 e 65535.");
const server = createApplication({
  dbPath: process.env.DATABASE_PATH
    ? resolve(process.env.DATABASE_PATH)
    : fileURLToPath(new URL("../data/restaurant.sqlite", import.meta.url)),
  staticDir: fileURLToPath(new URL("../../frontend/dist", import.meta.url)),
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",")
    .map((value) => value.trim())
    .filter(Boolean),
});
server.http.listen(port, "0.0.0.0", () => {
  console.log(`Servidor: http://localhost:${port} | Impressora: /impressora`);
  for (const entries of Object.values(networkInterfaces()))
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal)
        console.log(
          `LAN: http://${entry.address}:${port} (produção) / http://${entry.address}:5173 (desenvolvimento)`,
        );
    }
});
server.http.on("error", (error) => {
  console.error("Não foi possível iniciar o servidor:", error.message);
  void server.close().finally(() => {
    process.exitCode = 1;
  });
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
