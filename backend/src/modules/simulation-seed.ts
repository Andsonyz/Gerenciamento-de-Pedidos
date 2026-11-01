import { randomUUID } from "node:crypto";
import type { Role, User } from "@restaurante/shared";
import { passwordHash } from "./auth.js";
import type { Store } from "../database/store.js";
import { simulationSchema } from "../database/simulation-schema.js";

/** Must only be called with the dedicated training Store chosen by the server. */
export function seedSimulation(db: Store): User[] {
  db.raw.exec(simulationSchema);
  return db.tx(() => {
    const roles: [string, Role, string][] = [
      ["admin", "admin", "Administrador simulado"],
      ["caixa", "cashier", "Caixa simulado"],
      ["garcom", "waiter", "Garçom simulado"],
      ["cozinha", "kitchen", "Cozinha simulada"],
    ];
    for (const [username, role, name] of roles) {
      const old = db.get<{ role: string }>(
        "SELECT role FROM users WHERE username=?",
        username,
      );
      if (old && old.role !== role)
        throw new Error(`Papel incompatível no usuário simulado ${username}.`);
      if (!old)
        db.run(
          "INSERT INTO users(id,username,name,role,password_hash,active,created_at) VALUES(?,?,?,?,?,1,?)",
          randomUUID(),
          username,
          name,
          role,
          passwordHash("123"),
          new Date().toISOString(),
        );
    }
    for (let id = 1; id <= 12; id++)
      db.run(
        "INSERT OR IGNORE INTO dining_tables(id,name) VALUES(?,?)",
        id,
        `Mesa ${String(id).padStart(2, "0")}`,
      );
    db.run("UPDATE restaurant_settings SET name='Maison · Treinamento' WHERE id=1");
    return db
      .all<Omit<User, "active"> & { active: number }>(
        "SELECT id,username,name,role,active FROM users ORDER BY username",
      )
      .map((u) => ({ ...u, active: !!u.active }));
  });
}
