import { describe, expect, it } from "vitest";
import { Store } from "../src/database/store.js";
import { AuthService } from "../src/modules/auth.js";
import { resetDemoAccounts } from "../src/modules/demo-access.js";

describe("redefinição explícita de acessos", () => {
  it("preserva usuários e papéis, revoga sessões e mantém política normal", () => {
    const db = new Store(":memory:");
    try {
      const auth = new AuthService(db);
      for (const [username, role] of [
        ["admin", "admin"],
        ["caixa", "cashier"],
        ["garcom", "waiter"],
        ["cozinha", "kitchen"],
      ] as const)
        auth.saveUser(null, {
          username,
          name: username,
          role,
          active: true,
          password: "Strong-password-123!",
        });
      const ids = auth.users().map((u) => u.id);
      const session = auth.login("admin", "Strong-password-123!", "local");
      const accounts = resetDemoAccounts(db);
      expect(accounts).toHaveLength(4);
      expect(auth.users().map((u) => u.id)).toEqual(ids);
      expect(() => auth.session(session.token)).toThrow();
      for (const a of accounts)
        expect(auth.login(a.username, "123", "local").session.user.role).toBe(a.role);
      expect(() =>
        auth.saveUser(null, {
          username: "newuser",
          name: "Teste",
          role: "waiter",
          active: true,
          password: "123",
        }),
      ).toThrow();
    } finally {
      db.close();
    }
  });
  it("valida todos os papéis antes de alterar qualquer senha", () => {
    const db = new Store(":memory:");
    try {
      const auth = new AuthService(db);
      auth.saveUser(null, {
        username: "admin",
        name: "Administrador",
        role: "waiter",
        active: true,
        password: "Strong-password-123!",
      });
      expect(() => resetDemoAccounts(db)).toThrow();
      expect(auth.login("admin", "Strong-password-123!", "local").session.user.role).toBe(
        "waiter",
      );
    } finally {
      db.close();
    }
  });
});
