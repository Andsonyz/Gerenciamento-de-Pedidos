import { DatabaseSync, backup } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dbPath as operationalPath, simulationDbPath } from "./config.js";
const args = process.argv.slice(2),
  training = args.includes("--simulation");
const targets = args.filter((a) => a !== "--simulation");
if (targets.length > 1) throw new Error("Informe no máximo um arquivo de destino.");
const dbPath = training ? simulationDbPath : operationalPath;
if (!existsSync(dbPath)) throw new Error("Banco de origem não encontrado.");
const target = targets[0]
  ? resolve(targets[0])
  : fileURLToPath(
      new URL(
        `../backups/${training ? "simulation" : "restaurant"}-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
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
