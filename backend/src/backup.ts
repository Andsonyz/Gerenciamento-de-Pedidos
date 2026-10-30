import { DatabaseSync, backup } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dbPath } from "./config.js";
if (!existsSync(dbPath)) throw new Error("Banco de origem não encontrado.");
const target = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(
      new URL(
        `../backups/restaurant-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
        import.meta.url,
      ),
    );
if (resolve(target) === resolve(dbPath) || existsSync(target))
  throw new Error("Escolha um novo arquivo de destino para o backup.");
mkdirSync(dirname(target), { recursive: true });
const db = new DatabaseSync(dbPath, { readOnly: true });
try {
  await backup(db, target);
  console.log(`Backup consistente salvo em: ${target}`);
} finally {
  db.close();
}
