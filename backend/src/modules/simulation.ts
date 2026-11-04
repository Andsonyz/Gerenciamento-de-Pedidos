import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  User,
  SimulationConfig,
  SimulationGroup,
  SimulationState,
  SimulationEvent,
} from "@restaurante/shared";
import { simulationSchema } from "../database/simulation-schema.js";
import { HttpError } from "../errors.js";
import { Restaurant } from "./restaurant.js";
import { Finance } from "./finance.js";
import { Cancellations } from "./cancellations.js";
import { TableNotifications } from "./notifications.js";
import { Inventory } from "./inventory.js";
import { seedSimulationInventory } from "./demo-inventory.js";
import { seedSimulation } from "./simulation-seed.js";

const configSchema = z
  .object({
    mode: z.enum(["interactive", "automatic"]).default("interactive"),
    speed: z.union([z.literal(1), z.literal(2), z.literal(5)]).default(1),
    arrivalSeconds: z.number().int().min(1).max(3600).default(30),
    preparationSeconds: z.number().int().min(1).max(3600).default(120),
    diningSeconds: z.number().int().min(1).max(7200).default(180),
    maxGroups: z.number().int().min(1).max(100).default(100),
    seed: z.number().int().min(1).max(2147483647).default(42),
    autoKitchen: z.boolean().default(true),
    autoCashier: z.boolean().default(true),
    scenario: z
      .enum([
        "normal",
        "simultaneous",
        "partial-cancellation",
        "kitchen-failure",
        "shortage",
      ])
      .default("normal"),
  })
  .strict();
const defaults = configSchema.parse({});
interface Run {
  id: string;
  status: SimulationState["status"];
  config: string;
  elapsed_ms: number;
  base_time: string;
  prng: number;
  next_arrival_ms: number;
}
const stableId = (run: string, step: string) => {
  const h = createHash("sha256").update(`${run}:${step}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

/** Engine owns only the dedicated training Store supplied by createApplication. */
export class Simulation {
  private timer: ReturnType<typeof setInterval> | undefined;
  private finance: Finance;
  private cancellations: Cancellations;
  constructor(
    private r: Restaurant,
    private notify: () => void = () => {},
  ) {
    r.db.raw.exec(simulationSchema);
    this.finance = new Finance(r);
    this.cancellations = new Cancellations(r);
    r.db.run("UPDATE simulation_runs SET status='paused' WHERE status='running'");
    r.db.setClock(() => {
      const run = this.run();
      return run
        ? new Date(Date.parse(run.base_time) + run.elapsed_ms).toISOString()
        : new Date().toISOString();
    });
  }
  begin() {
    if (this.timer) return;
    let previous = Date.now();
    this.timer = setInterval(() => {
      const current = Date.now(),
        elapsed = Math.min((current - previous) / 1000, 5);
      previous = current;
      try {
        this.tick(elapsed * this.stateInternal().speed);
      } catch (error) {
        const run = this.run();
        if (run) {
          this.r.db.run("UPDATE simulation_runs SET status='paused' WHERE id=?", run.id);
          this.event(
            run,
            "error",
            `Execução pausada: ${error instanceof Error ? error.message : "falha inesperada"}`,
          );
          this.notify();
        }
      }
    }, 1000);
    this.timer.unref();
  }
  close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
  private run() {
    return this.r.db.get<Run>(
      "SELECT * FROM simulation_runs ORDER BY rowid DESC LIMIT 1",
    );
  }
  private admin(user: User) {
    if (user.role !== "admin")
      throw new HttpError(403, "Somente o administrador controla a simulação.");
  }
  private groups(run: Run): SimulationGroup[] {
    return this.r.db
      .all<Omit<SimulationGroup, "items"> & { items: string }>(
        "SELECT id,size,status,table_id as tableId,session_id as sessionId,order_id as orderId,waiter_id as waiterId,items,due_at as dueAt,error FROM simulation_groups WHERE run_id=? ORDER BY sequence",
        run.id,
      )
      .map((g) => ({ ...g, items: JSON.parse(g.items) as SimulationGroup["items"] }));
  }
  private stateInternal(): SimulationState {
    const run = this.run(),
      config = run ? (JSON.parse(run.config) as SimulationConfig) : defaults,
      groups = run ? this.groups(run) : [];
    return {
      id: run?.id ?? null,
      status: run?.status ?? "idle",
      mode: config.mode,
      speed: config.speed,
      config,
      elapsedSeconds: (run?.elapsed_ms ?? 0) / 1000,
      virtualTime: run
        ? new Date(Date.parse(run.base_time) + run.elapsed_ms).toISOString()
        : new Date().toISOString(),
      groups,
      events: run
        ? this.r.db.all<SimulationEvent>(
            "SELECT id,virtual_time as virtualTime,message,type FROM simulation_events WHERE run_id=? ORDER BY id DESC LIMIT 100",
            run.id,
          )
        : [],
      metrics: {
        arrived: groups.length,
        waiting: groups.filter((g) => g.status === "waiting").length,
        completed: groups.filter((g) => g.status === "completed").length,
        active: groups.filter((g) => g.status !== "completed").length,
      },
    };
  }
  state(user: User) {
    if (!user.active) throw new HttpError(403, "Usuário inativo.");
    return this.stateInternal();
  }
  private event(run: Run, type: SimulationEvent["type"], message: string) {
    this.r.db.run(
      "INSERT INTO simulation_events(run_id,virtual_time,message,type) VALUES(?,?,?,?)",
      run.id,
      new Date(Date.parse(run.base_time) + run.elapsed_ms).toISOString(),
      message,
      type,
    );
  }
  start(user: User, input: Partial<SimulationConfig>) {
    this.admin(user);
    const startInput = z
      .object({ requestId: z.string().uuid().optional() })
      .passthrough()
      .parse(input);
    const { requestId: _requestId, ...configuration } = startInput;
    const config = configSchema.parse(configuration),
      old = this.run();
    if (old && ["running", "paused", "stopped"].includes(old.status))
      throw new HttpError(409, "Reinicie o cenário anterior antes de iniciar outro.");
    if (config.scenario === "kitchen-failure") config.autoKitchen = false;
    this.r.db.tx(() => {
      const id = randomUUID();
      this.r.db.run(
        "INSERT INTO simulation_runs(id,status,config,base_time,prng,created_at) VALUES(?,'running',?,?,?,?)",
        id,
        JSON.stringify(config),
        new Date().toISOString(),
        config.seed,
        new Date().toISOString(),
      );
      this.event(
        this.run()!,
        "control",
        `Simulação ${config.mode === "automatic" ? "automática" : "interativa"} iniciada. Semente ${config.seed}.`,
      );
      if (config.scenario === "shortage") {
        const inventory = new Inventory(this.r.db);
        for (const ingredient of inventory.stock().filter((i) => i.physical > 0)) {
          inventory.adjust(user, {
            requestId: stableId(id, `shortage:${ingredient.id}`),
            ingredientId: ingredient.id,
            quantity: -ingredient.physical,
            kind: "adjustment",
            reason: "Cenário controlado de falta de ingredientes",
            overrideReason: "Déficit autorizado somente no ambiente de treinamento",
          });
        }
        this.event(
          this.run()!,
          "control",
          "Estoque de treinamento zerado por ajuste auditado para testar bloqueio de pedidos.",
        );
      }
      if (config.scenario === "kitchen-failure")
        this.event(
          this.run()!,
          "control",
          "Cozinha automática desconectada; trabalhos persistem até reativar a automação.",
        );
      this.r.db.audit(user.id, "simulation.started", id, { config });
    });
    this.notify();
    return this.state(user);
  }
  control(
    user: User,
    input: {
      action?: "pause" | "resume" | "stop" | "reset";
      speed?: 1 | 2 | 5;
      autoKitchen?: boolean;
      autoCashier?: boolean;
      requestId?: string;
    },
  ) {
    this.admin(user);
    const parsed = z
      .object({
        action: z.enum(["pause", "resume", "stop", "reset"]).optional(),
        speed: z.union([z.literal(1), z.literal(2), z.literal(5)]).optional(),
        autoKitchen: z.boolean().optional(),
        autoCashier: z.boolean().optional(),
        requestId: z.string().uuid().optional(),
      })
      .strict()
      .parse(input);
    if (parsed.action === "reset") {
      this.reset(user);
      this.notify();
      return this.state(user);
    }
    const run = this.run();
    if (!run) throw new HttpError(409, "Inicie um cenário primeiro.");
    if (run.status === "completed")
      throw new HttpError(409, "Cenário concluído. Reinicie para começar novamente.");
    const config = JSON.parse(run.config) as SimulationConfig;
    if (parsed.speed) config.speed = parsed.speed;
    if (parsed.autoKitchen !== undefined) config.autoKitchen = parsed.autoKitchen;
    if (parsed.autoCashier !== undefined) config.autoCashier = parsed.autoCashier;
    const status = !parsed.action
      ? run.status
      : parsed.action === "resume"
        ? "running"
        : parsed.action === "pause"
          ? "paused"
          : "stopped";
    this.r.db.tx(() => {
      this.r.db.run(
        "UPDATE simulation_runs SET status=?,config=? WHERE id=?",
        status,
        JSON.stringify(config),
        run.id,
      );
      this.event(
        run,
        "control",
        `Controle: ${parsed.action ?? "configuração"}. Velocidade ${config.speed}x.`,
      );
      this.r.db.audit(user.id, "simulation.control", run.id, parsed);
    });
    this.notify();
    return this.state(user);
  }
  private reset(user: User) {
    if (
      !this.r.db.get(
        "SELECT id FROM simulation_metadata WHERE id=1 AND label='training-only'",
      )
    )
      throw new HttpError(403, "Banco não identificado como treinamento.");
    // The Store is selected by the server. This destructive fixture reset is training-only.
    // Users, authenticated sessions and audit records remain available to the operator.
    this.r.db.withinTransaction(() => {
      const run = this.run();
      for (const table of [
        "dashboard_equipment",
        "dashboard_contribution_lines",
        "dashboard_contributions",
        "dashboard_sponsors",
        "dashboard_cash_entries",
        "simulation_events",
        "simulation_groups",
        "simulation_runs",
        "table_service_state",
        "inventory_movements",
        "inventory_reservations",
        "order_recipe_snapshots",
        "purchase_receipt_items",
        "purchase_receipts",
        "purchase_items",
        "purchases",
        "recipe_items",
        "recipe_versions",
        "supplier_ingredients",
        "ingredients",
        "suppliers",
        "print_jobs",
        "cancellations",
        "cancellation_requests",
        "refunds",
        "payments",
        "order_items",
        "service_orders",
        "table_sessions",
        "operations",
      ]) {
        if (
          this.r.db.get(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            table,
          )
        )
          this.r.db.run(`DELETE FROM ${table}`);
      }
      this.r.db.run("UPDATE dining_tables SET status='available'");
      seedSimulation(this.r.db);
      seedSimulationInventory(this.r.db);
      if (
        this.r.db.get(
          "SELECT name FROM sqlite_master WHERE name='dashboard_finance_settings'",
        )
      )
        this.r.db.run("UPDATE dashboard_finance_settings SET opening_cents=0 WHERE id=1");
      this.r.db.audit(user.id, "simulation.reset", run?.id ?? "empty", {});
      this.r.db.markDatasetReset();
    });
  }
  intent(user: User, id: string) {
    if (!["admin", "waiter"].includes(user.role))
      throw new HttpError(403, "Perfil sem permissão de atendimento.");
    const run = this.run();
    if (!run) throw new HttpError(404, "Cenário não encontrado.");
    const group = this.groups(run).find((g) => g.id === id);
    if (!group) throw new HttpError(404, "Grupo não encontrado.");
    if (group.status !== "requesting")
      throw new HttpError(409, "Grupo não está solicitando atendimento.");
    if (group.waiterId && group.waiterId !== user.id && user.role !== "admin")
      throw new HttpError(409, "Outro garçom assumiu este atendimento.");
    this.r.db.withinTransaction(() => {
      this.r.db.run("UPDATE simulation_groups SET waiter_id=? WHERE id=?", user.id, id);
      new TableNotifications(this.r.db).completeCall(user, group.sessionId!);
    });
    this.notify();
    return { ...group, waiterId: user.id };
  }
  serve(
    user: User,
    id: string,
    input: {
      items?: { productId: number; quantity: number }[];
      notes?: string;
      requestId?: string;
    } = {},
  ) {
    if (!["admin", "waiter"].includes(user.role))
      throw new HttpError(403, "Perfil sem permissão de atendimento.");
    const parsed = z
      .object({
        items: z
          .array(
            z
              .object({
                productId: z.number().int().positive(),
                quantity: z.number().int().min(1).max(99),
              })
              .strict(),
          )
          .min(1)
          .max(50)
          .optional(),
        notes: z.string().max(500).optional(),
        requestId: z.string().uuid().optional(),
      })
      .strict()
      .parse(input);
    const run = this.run();
    if (!run) throw new HttpError(404, "Cenário não encontrado.");
    const group = this.groups(run).find((g) => g.id === id);
    if (!group) throw new HttpError(404, "Grupo não encontrado.");
    if (group.waiterId && group.waiterId !== user.id && user.role !== "admin")
      throw new HttpError(403, "Atendimento de outro garçom.");
    if (group.orderId) return this.state(user);
    if (group.status !== "requesting" || !group.tableId || !group.sessionId)
      throw new HttpError(409, "Grupo não pode receber pedido agora.");
    this.r.db.withinTransaction(() => this.submit(run, group, user, parsed));
    this.notify();
    return this.state(user);
  }
  private actor(role: User["role"]) {
    const row = this.r.db.get<Omit<User, "active"> & { active: number }>(
      "SELECT id,username,name,role,active FROM users WHERE role=? AND active=1 ORDER BY created_at LIMIT 1",
      role,
    );
    if (!row) throw new HttpError(409, `Perfil ${role} não preparado na simulação.`);
    return { ...row, active: !!row.active };
  }
  private submit(
    run: Run,
    group: SimulationGroup,
    user: User,
    input: { items?: { productId: number; quantity: number }[]; notes?: string },
  ) {
    const order = this.r.createOrder(user, {
      requestId: stableId(run.id, `${group.id}:order`),
      tableId: group.tableId!,
      sessionId: group.sessionId!,
      items:
        input.items ??
        group.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      notes: input.notes ?? "Pedido de treinamento",
    }).value;
    this.r.db.run(
      "UPDATE simulation_groups SET status='ordered',order_id=?,waiter_id=?,due_at=?,error=NULL WHERE id=?",
      order.id,
      user.id,
      run.elapsed_ms +
        (JSON.parse(run.config) as SimulationConfig).preparationSeconds * 1000,
      group.id,
    );
    this.event(
      run,
      "service",
      `Mesa ${group.tableId}: pedido #${order.number} confirmado por ${user.name}.`,
    );
    if (
      (JSON.parse(run.config) as SimulationConfig).scenario === "partial-cancellation"
    ) {
      const item = order.items.find((i) => i.quantity > 1);
      if (item)
        this.cancellations.cancel(this.actor("admin"), order.id, {
          requestId: stableId(run.id, `${group.id}:partial-cancel`),
          reason: "Cliente simulado reduziu uma unidade",
          items: [{ itemId: item.id, quantity: 1 }],
        });
    }
  }
  tick(seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    let remaining = Math.min(Math.round(seconds * 1000), 3600000);
    let advanced = false;
    while (remaining > 0) {
      const run = this.run();
      if (!run || run.status !== "running") break;
      const step = Math.min(1000, remaining);
      advanced = true;
      remaining -= step;
      this.r.db.run(
        "UPDATE simulation_runs SET elapsed_ms=elapsed_ms+? WHERE id=?",
        step,
        run.id,
      );
      const current = this.run()!;
      this.arrivals(current);
      for (const group of this.groups(current)) {
        try {
          this.r.db.withinTransaction(() => this.process(current, group));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Falha no atendimento";
          if (group.error !== message) {
            this.r.db.run(
              "UPDATE simulation_groups SET error=? WHERE id=?",
              message,
              group.id,
            );
            this.event(
              current,
              "error",
              `Mesa ${group.tableId ?? "em espera"}: ${message}`,
            );
          }
        }
      }
      const groups = this.groups(current),
        config = JSON.parse(current.config) as SimulationConfig;
      if (
        groups.length >= config.maxGroups &&
        groups.every((g) => g.status === "completed")
      ) {
        this.r.db.run(
          "UPDATE simulation_runs SET status='completed' WHERE id=?",
          current.id,
        );
        this.event(current, "control", "Todos os grupos concluíram o atendimento.");
      }
    }
    if (advanced) this.notify();
  }
  private arrivals(run: Run) {
    const config = JSON.parse(run.config) as SimulationConfig;
    let count = this.groups(run).length;
    if (count >= config.maxGroups || run.elapsed_ms < run.next_arrival_ms) return;
    this.r.db.withinTransaction(() => {
      let seed = run.prng;
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      const batch =
        config.scenario === "simultaneous" ? Math.min(2, config.maxGroups - count) : 1;
      for (let n = 0; n < batch; n++) {
        count++;
        const size = 1 + Math.floor(random() * 4),
          products = this.r.products().filter((p) => p.available);
        if (!products.length)
          throw new HttpError(409, "Cardápio de treinamento sem produtos disponíveis.");
        const product = products[Math.floor(random() * products.length)]!;
        const quantity = config.scenario === "shortage" ? 99 : Math.max(2, size);
        const items = [{ productId: product.id, name: product.name, quantity }];
        this.r.db.run(
          "INSERT INTO simulation_groups(id,run_id,sequence,size,status,items,due_at) VALUES(?,?,?,?,'waiting',?,?)",
          stableId(run.id, `group:${count}`),
          run.id,
          count,
          size,
          JSON.stringify(items),
          run.elapsed_ms,
        );
        this.event(
          run,
          "arrival",
          `Grupo ${count}: ${size} ${size === 1 ? "cliente chegou" : "clientes chegaram"}.`,
        );
      }
      this.r.db.run(
        "UPDATE simulation_runs SET prng=?,next_arrival_ms=? WHERE id=?",
        seed,
        run.elapsed_ms + config.arrivalSeconds * 1000,
        run.id,
      );
    });
  }
  private process(run: Run, group: SimulationGroup) {
    const config = JSON.parse(run.config) as SimulationConfig;
    if (group.status === "waiting") {
      const table = this.r.tables().find((t) => t.status === "available" && !t.sessionId);
      if (!table) return;
      const waiter = this.actor("waiter"),
        session = this.r.open(
          waiter,
          table.id,
          stableId(run.id, `${group.id}:open`),
        ).value;
      this.r.db.run(
        "UPDATE simulation_groups SET status='requesting',table_id=?,session_id=?,error=NULL WHERE id=?",
        table.id,
        session.id,
        group.id,
      );
      this.event(
        run,
        "service",
        `Grupo acomodado na mesa ${table.id}; aguardando garçom.`,
      );
      group = {
        ...group,
        status: "requesting",
        tableId: table.id,
        sessionId: session.id,
      };
      // Keep seating durable even when the subsequent order is rejected by stock.
      return;
    }
    if (group.status === "requesting" && config.mode === "automatic") {
      this.submit(run, group, this.actor("waiter"), {});
      return;
    }
    if (group.status === "ordered" && group.orderId) {
      let order = this.r.order(group.orderId);
      if (order.status === "cancelled") {
        this.r.db.run(
          "UPDATE simulation_groups SET status='payment',due_at=? WHERE id=?",
          run.elapsed_ms,
          group.id,
        );
        return;
      }
      if (config.autoKitchen) {
        const kitchen = this.actor("kitchen");
        for (const job of this.r.printer
          .list()
          .filter(
            (j) =>
              j.orderId === order.id && (j.status === "pending" || j.status === "failed"),
          )) {
          this.r.printer.update(kitchen, job.id, "displayed");
        }
        if (order.status === "received") {
          this.r.orderStatus(kitchen, order.id, "preparing");
          this.r.db.run(
            "UPDATE simulation_groups SET due_at=?,error=NULL WHERE id=?",
            run.elapsed_ms + config.preparationSeconds * 1000,
            group.id,
          );
          return;
        }
        if (order.status === "preparing" && run.elapsed_ms >= group.dueAt)
          this.r.orderStatus(this.actor("kitchen"), order.id, "ready");
        order = this.r.order(order.id);
        if (order.status === "ready")
          this.r.orderStatus(this.actor("kitchen"), order.id, "delivered");
      }
      if (this.r.order(order.id).status === "delivered") {
        this.r.db.run(
          "UPDATE simulation_groups SET status='dining',due_at=?,error=NULL WHERE id=?",
          run.elapsed_ms + config.diningSeconds * 1000,
          group.id,
        );
        this.event(run, "kitchen", `Mesa ${group.tableId}: pedido servido.`);
      }
      return;
    }
    if (group.status === "dining" && run.elapsed_ms >= group.dueAt) {
      this.r.requestClose(this.actor("waiter"), group.sessionId!);
      this.r.db.run(
        "UPDATE simulation_groups SET status='payment',error=NULL WHERE id=?",
        group.id,
      );
      this.event(run, "payment", `Mesa ${group.tableId}: cliente solicitou a conta.`);
      group = { ...group, status: "payment" };
    }
    if (group.status === "payment" && group.sessionId) {
      let bill = this.r.bill(group.sessionId);
      if (config.autoCashier && bill.status !== "closed") {
        const cashier = this.actor("cashier");
        if (bill.balanceCents > 0)
          this.finance.pay(cashier, bill.id, {
            requestId: stableId(run.id, `${group.id}:payment`),
            method: "pix",
            amountCents: bill.balanceCents,
          });
        this.finance.close(cashier, bill.id, {
          requestId: stableId(run.id, `${group.id}:close`),
        });
        bill = this.r.bill(group.sessionId);
      }
      if (bill.status === "closed") {
        this.r.db.run(
          "UPDATE simulation_groups SET status='completed',error=NULL WHERE id=?",
          group.id,
        );
        this.event(
          run,
          "payment",
          `Mesa ${group.tableId}: atendimento concluído e mesa liberada.`,
        );
      }
    }
  }
}
