import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import type { AuthSession, User, UserInput, Role } from "@restaurante/shared";
import { Store, now } from "../database/store.js";
import { HttpError } from "../errors.js";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
function passwordMatches(password: string, stored: string) {
  const [salt, digest] = stored.split(":");
  if (!salt || !digest) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(digest, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function cookieToken(cookie: string | undefined) {
  return (
    cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("restaurant_session="))
      ?.slice("restaurant_session=".length) ?? ""
  );
}
interface UserRow {
  id: string;
  username: string;
  name: string;
  role: Role;
  active: number;
  password_hash: string;
}
const publicUser = (row: UserRow): User => ({
  id: row.id,
  username: row.username,
  name: row.name,
  role: row.role,
  active: !!row.active,
});
export class AuthService {
  private attempts = new Map<string, { count: number; until: number }>();
  constructor(private db: Store) {}
  users(): User[] {
    return this.db.all<UserRow>("SELECT * FROM users ORDER BY name").map(publicUser);
  }
  bootstrap(input: { username: string; password: string; name: string }) {
    if (this.users().length) return;
    if (input.password.length < 12)
      throw new Error("Senha inicial deve ter pelo menos 12 caracteres.");
    this.saveUser(null, { ...input, role: "admin", active: true });
  }
  saveUser(actor: string | null, input: UserInput, id?: string): User {
    return this.db.tx(() => {
      const existing = id
        ? this.db.get<UserRow>("SELECT * FROM users WHERE id=?", id)
        : undefined;
      if (id && !existing) throw new HttpError(404, "Usuário não encontrado.");
      if (!existing && !input.password)
        throw new HttpError(400, "Informe a senha inicial.");
      if (
        this.db.get(
          "SELECT id FROM users WHERE username=? AND id!=?",
          input.username,
          id ?? "",
        )
      )
        throw new HttpError(409, "Identificação já cadastrada.");
      if (
        existing?.role === "admin" &&
        existing.active &&
        (!input.active || input.role !== "admin") &&
        this.db.all("SELECT id FROM users WHERE role='admin' AND active=1").length === 1
      )
        throw new HttpError(409, "Mantenha pelo menos um administrador ativo.");
      const userId = id ?? randomUUID();
      const digest = input.password
        ? passwordHash(input.password)
        : existing!.password_hash;
      this.db.run(
        "INSERT INTO users(id,username,name,role,password_hash,active,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,name=excluded.name,role=excluded.role,password_hash=excluded.password_hash,active=excluded.active",
        userId,
        input.username,
        input.name,
        input.role,
        digest,
        Number(input.active),
        now(),
      );
      if (existing) this.db.run("DELETE FROM auth_sessions WHERE user_id=?", userId);
      this.db.audit(actor, "user.saved", userId, {
        username: input.username,
        name: input.name,
        role: input.role,
        active: input.active,
        passwordChanged: !!input.password,
      });
      return publicUser(this.db.get<UserRow>("SELECT * FROM users WHERE id=?", userId)!);
    });
  }
  login(
    username: string,
    password: string,
    ip: string,
  ): { session: AuthSession; token: string } {
    const key = ip;
    const time = Date.now();
    if (this.attempts.size > 1000)
      for (const [k, v] of this.attempts) if (v.until < time) this.attempts.delete(k);
    const prior = this.attempts.get(key);
    if (prior && prior.until > time && prior.count >= 15)
      throw new HttpError(429, "Muitas tentativas. Aguarde 15 minutos.");
    const row = this.db.get<UserRow>("SELECT * FROM users WHERE username=?", username);
    const valid = passwordMatches(
      password,
      row?.password_hash ?? "00000000000000000000000000000000:" + "00".repeat(64),
    );
    if (!row || !row.active || !valid) {
      this.attempts.set(key, {
        count: prior && prior.until > time ? prior.count + 1 : 1,
        until: prior && prior.until > time ? prior.until : time + 15 * 60_000,
      });
      throw new HttpError(401, "Identificação ou senha incorreta.");
    }
    this.attempts.delete(key);
    const token = randomBytes(32).toString("hex"),
      csrfToken = randomBytes(32).toString("hex"),
      expiresAt = new Date(time + 12 * 60 * 60_000).toISOString();
    this.db.run("DELETE FROM auth_sessions WHERE expires_at<=?", now());
    this.db.run(
      "INSERT INTO auth_sessions VALUES(?,?,?,?)",
      hashToken(token),
      row.id,
      csrfToken,
      expiresAt,
    );
    this.db.audit(row.id, "auth.login", row.id, {});
    return { token, session: { user: publicUser(row), csrfToken, expiresAt } };
  }
  session(token: string): AuthSession {
    const row = this.db.get<UserRow & { csrf_token: string; expires_at: string }>(
      "SELECT u.*,s.csrf_token,s.expires_at FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1",
      hashToken(token),
      now(),
    );
    if (!row) throw new HttpError(401, "Sua sessão expirou. Entre novamente.");
    return {
      user: publicUser(row),
      csrfToken: row.csrf_token,
      expiresAt: row.expires_at,
    };
  }
  logout(token: string) {
    this.db.run("DELETE FROM auth_sessions WHERE token_hash=?", hashToken(token));
  }
  middleware = (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = this.session(cookieToken(req.headers.cookie));
      res.locals.auth = session;
      if (
        !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
        req.get("X-CSRF-Token") !== session.csrfToken
      )
        throw new HttpError(403, "Sessão de segurança inválida. Atualize a página.");
      next();
    } catch (error) {
      next(error);
    }
  };
}
export const actor = (res: Response) => (res.locals.auth as AuthSession).user;
export const allow =
  (...roles: Role[]) =>
  (_req: Request, res: Response, next: NextFunction) => {
    if (!roles.includes(actor(res).role))
      return next(new HttpError(403, "Você não tem permissão para esta operação."));
    next();
  };
