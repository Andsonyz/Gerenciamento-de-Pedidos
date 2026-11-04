import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { User } from "@restaurante/shared";
import { Store } from "../database/store.js";
import { HttpError } from "../errors.js";
import { Inventory, requireAdmin } from "./inventory.js";

export const resourceSchema = `
CREATE TABLE IF NOT EXISTS dashboard_finance_settings(id INTEGER PRIMARY KEY CHECK(id=1),opening_cents INTEGER CHECK(opening_cents>=0));
INSERT OR IGNORE INTO dashboard_finance_settings VALUES(1,NULL);
CREATE TABLE IF NOT EXISTS dashboard_sponsors(id TEXT PRIMARY KEY,name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS dashboard_contributions(id TEXT PRIMARY KEY,sponsor_id TEXT NOT NULL REFERENCES dashboard_sponsors(id),cash_cents INTEGER NOT NULL CHECK(cash_cents>=0),valuation_cents INTEGER,status TEXT NOT NULL CHECK(status IN ('received','reversed')),notes TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dashboard_contribution_lines(id TEXT PRIMARY KEY,contribution_id TEXT NOT NULL REFERENCES dashboard_contributions(id),kind TEXT NOT NULL CHECK(kind IN ('ingredient','equipment')),ingredient_id TEXT REFERENCES ingredients(id),name TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),valuation_cents INTEGER);
CREATE TABLE IF NOT EXISTS dashboard_equipment(id TEXT PRIMARY KEY,contribution_id TEXT NOT NULL REFERENCES dashboard_contributions(id),name TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),valuation_cents INTEGER,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dashboard_cash_entries(id TEXT PRIMARY KEY,kind TEXT NOT NULL,amount_cents INTEGER NOT NULL,reference_id TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE VIEW IF NOT EXISTS dashboard_cash_ledger AS
 SELECT 'payment:'||id AS id,'sale' AS kind,amount_cents,session_id AS reference_id,'Recebimento de cliente' AS reason,method,created_at FROM payments
 UNION ALL SELECT 'refund:'||id,'refund',-amount_cents,payment_id,reason,NULL,created_at FROM refunds
 UNION ALL SELECT id,kind,amount_cents,reference_id,reason,NULL,created_at FROM dashboard_cash_entries;
`;
const cents = z.number().int().min(0).max(100_000_000);
const reason = z.string().trim().min(3).max(500);
const requestId = z.uuid();
const line = z.strictObject({
  kind: z.enum(["ingredient", "equipment"]),
  ingredientId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(120),
  quantity: z.number().int().min(1).max(1_000_000_000),
  valuationCents: cents.nullable(),
});
export const contributionInput = z
  .strictObject({
    requestId,
    sponsorId: z.string().min(1),
    cashCents: cents,
    notes: z.string().max(1000),
    lines: z.array(line).max(100),
  })
  .refine((v) => v.cashCents > 0 || v.lines.length > 0);
export const cashInput = z
  .strictObject({
    requestId,
    kind: z.enum(["expense", "other_inflow", "purchase_payment"]),
    amountCents: cents.positive(),
    purchaseId: z.string().optional(),
    reason,
  })
  .refine((v) => (v.kind === "purchase_payment" ? !!v.purchaseId : !v.purchaseId), {
    message: "Vincule uma compra somente ao pagamento de compra.",
  });
export type ContributionInput = z.infer<typeof contributionInput>;
export type CashInput = z.infer<typeof cashInput>;
export interface CashRow {
  id: string;
  kind: string;
  amountCents: number;
  referenceId: string;
  reason: string;
  method: string | null;
  occurredAt: string;
}
export class TrainingResources {
  constructor(readonly db: Store) {
    if (
      !db.get("SELECT name FROM sqlite_master WHERE name='simulation_metadata'") ||
      !db.get("SELECT id FROM simulation_metadata WHERE label='training-only'")
    )
      throw new HttpError(403, "Recursos disponíveis apenas no treinamento.");
    db.raw.exec(resourceSchema);
  }
  state() {
    return {
      openingBalanceCents: this.db.get<{ opening_cents: number | null }>(
        "SELECT opening_cents FROM dashboard_finance_settings WHERE id=1",
      )!.opening_cents,
      sponsors: this.db
        .all<{ id: string; name: string; active: number }>(
          "SELECT * FROM dashboard_sponsors ORDER BY name",
        )
        .map((s) => ({ ...s, active: !!s.active })),
      contributions: this.db.all<{
        id: string;
        sponsorId: string;
        cashCents: number;
        valuationCents: number | null;
        status: string;
        notes: string;
        occurredAt: string;
      }>(
        "SELECT id,sponsor_id AS sponsorId,cash_cents AS cashCents,valuation_cents AS valuationCents,status,notes,created_at AS occurredAt FROM dashboard_contributions ORDER BY created_at DESC",
      ),
      lines: this.db.all<{
        id: string;
        contributionId: string;
        kind: string;
        ingredientId: string | null;
        name: string;
        quantity: number;
        valuationCents: number | null;
      }>(
        "SELECT id,contribution_id AS contributionId,kind,ingredient_id AS ingredientId,name,quantity,valuation_cents AS valuationCents FROM dashboard_contribution_lines",
      ),
      equipment: this.db
        .all<{
          id: string;
          contributionId: string;
          name: string;
          quantity: number;
          valuationCents: number | null;
          active: number;
          occurredAt: string;
        }>(
          "SELECT id,contribution_id AS contributionId,name,quantity,valuation_cents AS valuationCents,active,created_at AS occurredAt FROM dashboard_equipment",
        )
        .map((e) => ({ ...e, active: !!e.active })),
      ledger: this.db.all<CashRow>(
        "SELECT id,kind,amount_cents AS amountCents,reference_id AS referenceId,reason,method,created_at AS occurredAt FROM dashboard_cash_ledger ORDER BY created_at DESC,id",
      ),
    };
  }
  saveSponsor(user: User, input: { name: string }) {
    requireAdmin(user);
    const name = z.string().trim().min(2).max(120).parse(input.name);
    return this.db.tx(() => {
      const id = randomUUID();
      this.db.run("INSERT INTO dashboard_sponsors VALUES(?,?,1)", id, name);
      this.db.audit(user.id, "sponsor.created", id, { name });
      return { id, name, active: true };
    });
  }
  receive(user: User, input: ContributionInput) {
    requireAdmin(user);
    const v = contributionInput.parse(input);
    return this.db.operation(user.id, v.requestId, "sponsorship.receive", v, () => {
      if (
        !this.db.get(
          "SELECT id FROM dashboard_sponsors WHERE id=? AND active=1",
          v.sponsorId,
        )
      )
        throw new HttpError(404, "Patrocinador não encontrado.");
      const id = randomUUID(),
        at = this.db.timestamp();
      const valuation = v.lines.some((l) => l.valuationCents === null)
        ? null
        : v.lines.reduce((s, l) => s + (l.valuationCents ?? 0), 0);
      this.db.run(
        "INSERT INTO dashboard_contributions VALUES(?,?,?,?,?,?,?)",
        id,
        v.sponsorId,
        v.cashCents,
        valuation,
        "received",
        v.notes,
        at,
      );
      const inv = new Inventory(this.db);
      for (const l of v.lines) {
        const lid = randomUUID();
        if (l.kind === "ingredient") {
          if (!l.ingredientId)
            throw new HttpError(400, "Selecione o ingrediente recebido.");
          inv.ingredient(l.ingredientId);
          inv.record(
            user,
            l.ingredientId,
            "receipt",
            l.quantity,
            0,
            0,
            `sponsorship:${lid}`,
            "Recebimento de patrocínio",
          );
        }
        this.db.run(
          "INSERT INTO dashboard_contribution_lines VALUES(?,?,?,?,?,?,?)",
          lid,
          id,
          l.kind,
          l.kind === "ingredient" ? l.ingredientId! : null,
          l.name,
          l.quantity,
          l.valuationCents,
        );
        if (l.kind === "equipment")
          this.db.run(
            "INSERT INTO dashboard_equipment VALUES(?,?,?,?,?,1,?)",
            lid,
            id,
            l.name,
            l.quantity,
            l.valuationCents,
            at,
          );
      }
      if (v.cashCents)
        this.db.run(
          "INSERT INTO dashboard_cash_entries VALUES(?,?,?,?,?,?)",
          `sponsorship:${id}`,
          "sponsorship",
          v.cashCents,
          id,
          "Patrocínio em dinheiro",
          at,
        );
      this.db.audit(user.id, "sponsorship.received", id, v);
      return { id };
    }).value;
  }
  reverseContribution(user: User, id: string, key: string, why: string) {
    requireAdmin(user);
    requestId.parse(key);
    reason.parse(why);
    return this.db.operation(user.id, key, "sponsorship.reverse", { id, why }, () => {
      const c = this.db.get<{ cash_cents: number; status: string }>(
        "SELECT * FROM dashboard_contributions WHERE id=?",
        id,
      );
      if (!c) throw new HttpError(404, "Contribuição não encontrada.");
      if (c.status !== "received") throw new HttpError(409, "Contribuição já revertida.");
      const inv = new Inventory(this.db);
      for (const l of this.db.all<{
        id: string;
        ingredient_id: string | null;
        quantity: number;
      }>(
        "SELECT * FROM dashboard_contribution_lines WHERE contribution_id=? AND kind='ingredient'",
        id,
      )) {
        if (inv.ingredient(l.ingredient_id!).available < l.quantity)
          throw new HttpError(
            409,
            "O alimento recebido já está reservado ou consumido; registre um ajuste justificado.",
          );
        inv.record(
          user,
          l.ingredient_id!,
          "adjustment",
          -l.quantity,
          0,
          0,
          `sponsorship-reversal:${l.id}`,
          why,
        );
      }
      this.db.run("UPDATE dashboard_equipment SET active=0 WHERE contribution_id=?", id);
      this.db.run("UPDATE dashboard_contributions SET status='reversed' WHERE id=?", id);
      if (c.cash_cents)
        this.db.run(
          "INSERT INTO dashboard_cash_entries VALUES(?,?,?,?,?,?)",
          `sponsorship-reversal:${id}`,
          "reversal",
          -c.cash_cents,
          id,
          why,
          this.db.timestamp(),
        );
      this.db.audit(user.id, "sponsorship.reversed", id, { why });
      return { ok: true };
    }).value;
  }
  setOpeningBalance(
    user: User,
    input: { requestId: string; amountCents: number; reason: string },
  ) {
    requireAdmin(user);
    const v = z.strictObject({ requestId, amountCents: cents, reason }).parse(input);
    return this.db.operation(user.id, v.requestId, "cash.opening", v, () => {
      if (this.state().openingBalanceCents !== null)
        throw new HttpError(409, "Abertura já registrada para esta rodada.");
      this.db.run(
        "UPDATE dashboard_finance_settings SET opening_cents=? WHERE id=1",
        v.amountCents,
      );
      this.db.audit(user.id, "cash.opening", "1", v);
      return { ok: true };
    }).value;
  }
  entry(user: User, input: CashInput) {
    requireAdmin(user);
    const v = cashInput.parse(input);
    return this.db.operation(user.id, v.requestId, "cash.entry", v, () => {
      if (v.kind === "purchase_payment") {
        if (!v.purchaseId) throw new HttpError(400, "Selecione a compra.");
        const p = this.db.get<{ status: string; due: number }>(
          "SELECT p.status,COALESCE(SUM(CASE WHEN p.status='cancelled' THEN i.received_cents ELSE i.total_cents END),0) AS due FROM purchases p LEFT JOIN purchase_items i ON i.purchase_id=p.id WHERE p.id=? GROUP BY p.id",
          v.purchaseId,
        );
        if (!p || p.status === "draft")
          throw new HttpError(409, "Confirme a compra antes de pagar.");
        const paid = this.db.get<{ n: number }>(
          "SELECT -COALESCE(SUM(e.amount_cents),0) n FROM dashboard_cash_entries e WHERE e.reference_id=? AND (e.kind='purchase_payment' OR (e.kind='reversal' AND EXISTS(SELECT 1 FROM dashboard_cash_entries original WHERE original.kind='purchase_payment' AND e.id='reversal:'||original.id AND original.reference_id=e.reference_id)))",
          v.purchaseId,
        )!.n;
        if (v.amountCents > p.due - paid)
          throw new HttpError(409, "Pagamento excede o saldo devido da compra.");
      }
      const id = randomUUID();
      this.db.run(
        "INSERT INTO dashboard_cash_entries VALUES(?,?,?,?,?,?)",
        id,
        v.kind,
        v.kind === "other_inflow" ? v.amountCents : -v.amountCents,
        v.purchaseId ?? id,
        v.reason,
        this.db.timestamp(),
      );
      this.db.audit(user.id, "cash.entry", id, v);
      return { id };
    }).value;
  }
  reverseEntry(user: User, id: string, key: string, why: string) {
    requireAdmin(user);
    requestId.parse(key);
    reason.parse(why);
    return this.db.operation(user.id, key, "cash.reverse", { id, why }, () => {
      const e = this.db.get<{ kind: string; amount_cents: number; reference_id: string }>(
        "SELECT * FROM dashboard_cash_entries WHERE id=?",
        id,
      );
      if (!e || !["expense", "other_inflow", "purchase_payment"].includes(e.kind))
        throw new HttpError(409, "Reverta o recebimento na operação de origem.");
      if (
        this.db.get("SELECT id FROM dashboard_cash_entries WHERE id=?", `reversal:${id}`)
      )
        throw new HttpError(409, "Lançamento já revertido.");
      this.db.run(
        "INSERT INTO dashboard_cash_entries VALUES(?,?,?,?,?,?)",
        `reversal:${id}`,
        "reversal",
        -e.amount_cents,
        e.reference_id,
        why,
        this.db.timestamp(),
      );
      this.db.audit(user.id, "cash.reversed", id, { why });
      return { ok: true };
    }).value;
  }
}
