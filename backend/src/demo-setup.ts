import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { Role } from "@restaurante/shared";
import { Store } from "./database/store.js";
import { AuthService } from "./modules/auth.js";
import { dbPath } from "./config.js";

const accessPath = fileURLToPath(new URL("../../.local-access.json", import.meta.url));
if (existsSync(accessPath))
  throw new Error(
    "O arquivo .local-access.json já existe. Consulte os acessos locais; nenhuma senha foi alterada.",
  );
const db = new Store(dbPath);
try {
  const auth = new AuthService(db),
    accounts: { username: string; name: string; role: Role; password: string }[] = [];
  for (const [username, name, role] of [
    ["admin", "Administrador", "admin"],
    ["caixa", "Caixa de teste", "cashier"],
    ["garcom", "Garçom de teste", "waiter"],
    ["cozinha", "Cozinha de teste", "kitchen"],
  ] as const) {
    if (auth.users().some((u) => u.username.toLowerCase() === username)) {
      console.log(`${username}: conta existente preservada.`);
      continue;
    }
    const password = randomBytes(12).toString("base64url") + "!7";
    auth.saveUser(null, { username, name, role, password, active: true });
    accounts.push({ username, name, role, password });
  }
  writeFileSync(
    accessPath,
    JSON.stringify(
      { database: resolve(dbPath), createdAt: new Date().toISOString(), accounts },
      null,
      2,
    ),
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  console.log(
    "Acessos locais criados. Arquivo privado: .local-access.json (não versionado).",
  );
  for (const account of accounts)
    console.log(`${account.role}: ${account.username} / ${account.password}`);
  console.log(
    "Altere/desative os acessos de teste em Equipe antes de utilizar dados reais.",
  );
} finally {
  db.close();
}
