import { writeFileSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Store } from "./database/store.js";
import { dbPath, simulationDbPath } from "./config.js";
import { resetDemoAccounts, validateDemoAccounts } from "./modules/demo-access.js";
import { seedSimulation } from "./modules/simulation-seed.js";
import { assertSeparateDatabases } from "./database/identity.js";
assertSeparateDatabases(dbPath, simulationDbPath);
const db = new Store(dbPath);
let training: Store | undefined;
try {
  validateDemoAccounts(db);
  training = new Store(simulationDbPath);
  seedSimulation(training);
  validateDemoAccounts(training);
  const accounts = resetDemoAccounts(db);
  const simulationAccounts = resetDemoAccounts(training);
  const target = fileURLToPath(new URL("../../.local-access.json", import.meta.url));
  writeFileSync(
    `${target}.tmp`,
    JSON.stringify(
      {
        database: resolve(dbPath),
        simulationDatabase: resolve(simulationDbPath),
        createdAt: new Date().toISOString(),
        accounts,
        simulationAccounts,
      },
      null,
      2,
    ),
    { encoding: "utf8", mode: 0o600 },
  );
  renameSync(`${target}.tmp`, target);
  console.log(
    "Quatro acessos locais redefinidos. Consulte .local-access.json. Sessões anteriores revogadas.",
  );
} finally {
  db.close();
  training?.close();
}
