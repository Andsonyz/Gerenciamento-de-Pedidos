import { passwordHash } from "./auth.js";
import { Store } from "../database/store.js";
import type { Role } from "@restaurante/shared";

const expected = [
  ["admin", "admin"],
  ["caixa", "cashier"],
  ["garcom", "waiter"],
  ["cozinha", "kitchen"],
] as const;
export function validateDemoAccounts(db: Store) {
  return expected.map(([username, role]) => {
    const user = db.get<{ id: string; username: string; name: string; role: Role }>(
      "SELECT id,username,name,role FROM users WHERE username=?",
      username,
    );
    if (!user || user.role !== role)
      throw new Error(
        `Conta ${username} ausente ou com papel inesperado; nenhuma senha foi alterada.`,
      );
    return user;
  });
}
export function resetDemoAccounts(db: Store) {
  return db.tx(() => {
    const users = validateDemoAccounts(db);
    for (const user of users) {
      db.run("UPDATE users SET password_hash=? WHERE id=?", passwordHash("123"), user.id);
      db.run("DELETE FROM auth_sessions WHERE user_id=?", user.id);
      db.audit(null, "auth.demo-reset", user.id, { username: user.username });
    }
    return users.map(({ username, name, role }) => ({
      username,
      name,
      role,
      password: "123",
    }));
  });
}
