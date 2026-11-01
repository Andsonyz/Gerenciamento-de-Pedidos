import { afterEach, describe, expect, it } from "vitest";
import { Store } from "../src/database/store.js";
import { Restaurant } from "../src/modules/restaurant.js";
import { VirtualPrinterAdapter } from "../src/printing/VirtualPrinterAdapter.js";
import { seedSimulation } from "../src/modules/simulation-seed.js";
import { Simulation } from "../src/modules/simulation.js";
import { seedSimulationInventory } from "../src/modules/demo-inventory.js";
import { Inventory } from "../src/modules/inventory.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const stores: Store[] = [];
const temporaryDirectories: string[] = [];
function fixture(path = ":memory:") {
  const db = new Store(path);
  stores.push(db);
  const users = seedSimulation(db),
    admin = users.find((u) => u.role === "admin")!,
    waiter = users.find((u) => u.role === "waiter")!;
  seedSimulationInventory(db);
  const r = new Restaurant(db, new VirtualPrinterAdapter(db));
  return { db, r, admin, waiter, simulation: new Simulation(r) };
}
afterEach(() => {
  for (const db of stores.splice(0)) db.close();
  for (const directory of temporaryDirectories.splice(0)) {
    if (
      !resolve(directory).startsWith(resolve(tmpdir()) + "\\restaurant-simulation-test-")
    )
      throw new Error("Diretório temporário fora do escopo do teste.");
    rmSync(directory, { recursive: true, force: true });
  }
});
describe("simulação persistente e isolada", () => {
  it("executa ciclo automático com os serviços reais, sem duplicar pagamentos", () => {
    const { simulation, admin, db } = fixture();
    simulation.start(admin, {
      mode: "automatic",
      maxGroups: 2,
      arrivalSeconds: 1,
      preparationSeconds: 2,
      diningSeconds: 2,
    });
    simulation.tick(15);
    expect(simulation.state(admin).metrics.completed).toBe(2);
    expect(simulation.state(admin).status).toBe("completed");
    const payments = db.get<{ n: number }>("SELECT COUNT(*) n FROM payments")!.n;
    simulation.tick(30);
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM payments")!.n).toBe(payments);
    expect(
      db.get<{ n: number }>(
        "SELECT COUNT(*) n FROM table_sessions WHERE status!='closed'",
      )!.n,
    ).toBe(0);
  });
  it("recupera execução pausada, preservando relógio e grupos", () => {
    const { simulation, r, admin } = fixture();
    simulation.start(admin, { maxGroups: 1, arrivalSeconds: 1 });
    simulation.tick(3);
    const before = simulation.state(admin);
    const restored = new Simulation(r);
    expect(restored.state(admin)).toMatchObject({
      status: "paused",
      elapsedSeconds: before.elapsedSeconds,
      groups: before.groups,
    });
    restored.tick(10);
    expect(restored.state(admin).elapsedSeconds).toBe(before.elapsedSeconds);
    restored.control(admin, { action: "resume" });
    restored.tick(1);
    expect(restored.state(admin).elapsedSeconds).toBe(before.elapsedSeconds + 1);
  });
  it("exige administrador nos controles e confirma intenção interativa uma única vez", () => {
    const { simulation, admin, waiter, db } = fixture();
    expect(() => simulation.start(waiter, {})).toThrow();
    simulation.start(admin, { maxGroups: 1 });
    simulation.tick(1);
    const group = simulation.state(waiter).groups[0]!;
    expect(group.status).toBe("requesting");
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM service_orders")!.n).toBe(0);
    simulation.intent(waiter, group.id);
    simulation.serve(waiter, group.id, {});
    simulation.serve(waiter, group.id, {});
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM service_orders")!.n).toBe(1);
    expect(() => simulation.control(waiter, { action: "reset" })).toThrow();
  });
  it("preserva fila de cozinha durante falha e recupera os trabalhos", () => {
    const { simulation, admin, db } = fixture();
    simulation.start(admin, {
      mode: "automatic",
      scenario: "kitchen-failure",
      maxGroups: 1,
      preparationSeconds: 1,
      diningSeconds: 1,
    });
    simulation.tick(8);
    expect(
      db.get<{ n: number }>("SELECT COUNT(*) n FROM print_jobs WHERE status='pending'")!
        .n,
    ).toBe(1);
    expect(simulation.state(admin).metrics.completed).toBe(0);
    simulation.control(admin, { autoKitchen: true });
    simulation.tick(8);
    expect(simulation.state(admin).metrics.completed).toBe(1);
    expect(
      db.get<{ n: number }>("SELECT COUNT(*) n FROM print_jobs WHERE status='displayed'")!
        .n,
    ).toBe(1);
  });
  it("bloqueia cenário de falta e reseta apenas o banco de treinamento", () => {
    const real = new Store(":memory:");
    stores.push(real);
    const before = real.get<{ n: number }>("SELECT COUNT(*) n FROM service_orders")!.n;
    const { simulation, admin, db } = fixture();
    simulation.start(admin, { mode: "automatic", scenario: "shortage", maxGroups: 1 });
    simulation.tick(4);
    expect(simulation.state(admin).groups[0]!.status).toBe("requesting");
    expect(simulation.state(admin).groups[0]!.error).toBeTruthy();
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM service_orders")!.n).toBe(0);
    simulation.control(admin, { action: "reset" });
    expect(simulation.state(admin).status).toBe("idle");
    expect(new Inventory(db).stock().every((i) => i.physical > 0)).toBe(true);
    expect(real.get<{ n: number }>("SELECT COUNT(*) n FROM service_orders")!.n).toBe(
      before,
    );
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM users")!.n).toBe(4);
    expect(
      db.get<{ n: number }>(
        "SELECT COUNT(*) n FROM audit_log WHERE action='simulation.reset'",
      )!.n,
    ).toBe(1);
  });
  it("cancela parcialmente usando os registros reais e preserva receita original", () => {
    const { simulation, admin, db } = fixture();
    simulation.start(admin, {
      mode: "automatic",
      scenario: "partial-cancellation",
      maxGroups: 1,
      preparationSeconds: 1,
      diningSeconds: 1,
    });
    simulation.tick(12);
    expect(simulation.state(admin).metrics.completed).toBe(1);
    expect(db.get<{ n: number }>("SELECT SUM(quantity) n FROM cancellations")!.n).toBe(1);
    expect(
      db.get<{ n: number }>(
        "SELECT COUNT(*) n FROM print_jobs WHERE type='cancellation'",
      )!.n,
    ).toBe(1);
  });
  it("reproduz clientes e intenções por semente, incluindo chegadas simultâneas", () => {
    const a = fixture(),
      b = fixture();
    for (const f of [a, b]) {
      f.simulation.start(f.admin, { scenario: "simultaneous", maxGroups: 2, seed: 17 });
      f.simulation.tick(1);
    }
    const summary = (f: ReturnType<typeof fixture>) =>
      f.simulation
        .state(f.admin)
        .groups.map((g) => ({ size: g.size, items: g.items, status: g.status }));
    expect(summary(a)).toEqual(summary(b));
    expect(summary(a)).toHaveLength(2);
  });
  it("recupera checkpoint do arquivo SQLite após encerrar a conexão", () => {
    const directory = mkdtempSync(join(tmpdir(), "restaurant-simulation-test-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "training.sqlite"),
      first = fixture(path);
    first.simulation.start(first.admin, {
      mode: "automatic",
      maxGroups: 1,
      preparationSeconds: 3,
      diningSeconds: 1,
    });
    first.simulation.tick(3);
    const before = first.simulation.state(first.admin);
    first.simulation.close();
    first.db.close();
    stores.splice(stores.indexOf(first.db), 1);
    const reopened = fixture(path),
      restored = reopened.simulation.state(reopened.admin);
    expect(restored).toMatchObject({
      status: "paused",
      elapsedSeconds: before.elapsedSeconds,
      groups: before.groups,
    });
    reopened.simulation.control(reopened.admin, { action: "resume" });
    reopened.simulation.tick(12);
    expect(reopened.simulation.state(reopened.admin).metrics.completed).toBe(1);
    expect(
      reopened.db.get<{ n: number }>("SELECT COUNT(*) n FROM service_orders")!.n,
    ).toBe(1);
    expect(reopened.db.get<{ n: number }>("SELECT COUNT(*) n FROM payments")!.n).toBe(1);
  });
});
