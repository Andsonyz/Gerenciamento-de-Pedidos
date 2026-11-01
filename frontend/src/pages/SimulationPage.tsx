import { useState } from "react";
import { TableAttentionBadge } from "../Notifications";
import { Link } from "react-router-dom";
import {
  Armchair,
  ChefHat,
  Clock3,
  Pause,
  Play,
  RotateCcw,
  Square,
  Users,
  UtensilsCrossed,
} from "lucide-react";
import type {
  SimulationConfig,
  SimulationGroup,
  SimulationState,
} from "@restaurante/shared";
import { api, dateTime } from "../api";
import { Empty, Field, Form, Heading, Modal, str } from "../components";
import { SIMULATION } from "../environment";
import { useStore } from "../state";
import { useOperationData } from "./InventoryPage";

const config: SimulationConfig = {
  mode: "interactive",
  speed: 1,
  arrivalSeconds: 30,
  preparationSeconds: 120,
  diningSeconds: 180,
  maxGroups: 100,
  seed: 42,
  autoKitchen: true,
  autoCashier: true,
  scenario: "normal",
};
const initial: SimulationState = {
  id: null,
  status: "idle",
  mode: "interactive",
  speed: 1,
  virtualTime: new Date().toISOString(),
  elapsedSeconds: 0,
  config,
  groups: [],
  events: [],
  metrics: { arrived: 0, waiting: 0, completed: 0, active: 0 },
};
const labels: Record<string, string> = {
  idle: "Pronta para iniciar",
  running: "Em execução",
  paused: "Pausada",
  stopped: "Encerrada",
  completed: "Concluída",
  waiting: "Aguardando mesa",
  requesting: "Chamando o garçom",
  ordered: "Pedido confirmado",
  dining: "Consumindo",
  payment: "Aguardando caixa",
};

function TrainingLanding() {
  return (
    <>
      <Heading
        eyebrow="TREINAMENTO OPERACIONAL"
        title="Um salão para aprender e testar"
        description="Pratique atendimento, cozinha, caixa e abastecimento em um ambiente independente."
      />
      <section className="panel ops-simulation-intro">
        <span className="ops-intro-icon">
          <UtensilsCrossed size={40} />
        </span>
        <h2>Simulação do restaurante</h2>
        <p>
          Clientes chegam, ocupam mesas e solicitam pedidos. Atenda como garçom ou
          acompanhe um ciclo automático completo, incluindo cozinha e pagamentos
          simulados.
        </p>
        <div className="ops-card-grid">
          <article className="ops-card">
            <Users size={24} />
            <h3>Interativo</h3>
            <p className="muted">
              Assuma mesas e revise os pedidos dos clientes antes de confirmar.
            </p>
          </article>
          <article className="ops-card">
            <Clock3 size={24} />
            <h3>Automático</h3>
            <p className="muted">
              Acompanhe chegadas, preparo, consumo e liberação das mesas.
            </p>
          </article>
          <article className="ops-card">
            <Armchair size={24} />
            <h3>Banco independente</h3>
            <p className="muted">
              Compras, estoque, pagamentos e comandas de treinamento ficam separados.
            </p>
          </article>
        </div>
        <a href="/simulacao/" className="button primary">
          Abrir simulação
        </a>
        <small className="muted">
          Faça login na área de treinamento com o perfil desejado. Somente administradores
          controlam os cenários.
        </small>
      </section>
    </>
  );
}

function SimulationRoom() {
  const { auth, data, mutate, notify } = useStore();
  const admin = auth?.user.role === "admin";
  const canServe = admin || auth?.user.role === "waiter";
  const {
    value: state,
    refresh,
    error,
  } = useOperationData<SimulationState>("/simulation", initial, 1000);
  const [setup, setSetup] = useState(false);
  const [confirmation, setConfirmation] = useState<"reset" | "stop" | null>(null);
  const [group, setGroup] = useState<SimulationGroup | null>(null);
  const [rows, setRows] = useState<{ productId: number; quantity: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const [view, setView] = useState("map");
  async function control(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setLocalError("");
    try {
      await api("/simulation/control", { method: "POST", body: JSON.stringify(body) });
      await refresh();
    } catch (cause) {
      setLocalError(
        cause instanceof Error ? cause.message : "Falha ao alterar o cenário.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function attend(g: SimulationGroup) {
    if (busy) return;
    setBusy(true);
    setLocalError("");
    try {
      await api(`/simulation/groups/${g.id}/claim`, { method: "POST", body: "{}" });
      setRows(g.items.map((i) => ({ productId: i.productId, quantity: i.quantity })));
      setGroup(g);
      await refresh();
    } catch (cause) {
      setLocalError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível assumir o atendimento.",
      );
    } finally {
      setBusy(false);
    }
  }
  const active = state.groups.filter((g) => g.status !== "completed");
  return (
    <>
      <Heading
        eyebrow="SALÃO DE TREINAMENTO"
        title="Restaurante em movimento"
        description="Clientes e equipe simulados seguem as mesmas regras operacionais do sistema."
      >
        {admin && (
          <>
            {["idle", "stopped", "completed"].includes(state.status) && (
              <button className="button primary" onClick={() => setSetup(true)}>
                <Play size={16} /> Configurar e iniciar
              </button>
            )}
            {state.status === "running" && (
              <button
                className="button subtle"
                disabled={busy}
                onClick={() => void control({ action: "pause" })}
              >
                <Pause size={16} /> Pausar
              </button>
            )}
            {state.status === "paused" && (
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void control({ action: "resume" })}
              >
                <Play size={16} /> Continuar
              </button>
            )}
            {["running", "paused"].includes(state.status) && (
              <button className="button subtle" onClick={() => setConfirmation("stop")}>
                <Square size={15} /> Encerrar
              </button>
            )}
            <button
              className="button subtle"
              disabled={busy}
              onClick={() => setConfirmation("reset")}
            >
              <RotateCcw size={16} /> Reiniciar cenário
            </button>
          </>
        )}
      </Heading>
      <div className="ops-training-banner" role="note">
        <strong>AMBIENTE SIMULADO — DADOS DE TREINAMENTO</strong>
        <span>
          Horário virtual: {dateTime(state.virtualTime)} · {labels[state.status]}
        </span>
      </div>
      {(error || localError) && (
        <p className="alert error" role="alert">
          {error || localError}
        </p>
      )}
      <div className="stats-grid">
        <article className="stat-card">
          <span>Grupos que chegaram</span>
          <strong>{state.metrics.arrived}</strong>
          <small>Limite do cenário: {state.config.maxGroups}</small>
        </article>
        <article className="stat-card">
          <span>Fila de espera</span>
          <strong>{state.metrics.waiting}</strong>
          <small>Aguardando mesa disponível</small>
        </article>
        <article className="stat-card">
          <span>Em atendimento</span>
          <strong>{state.metrics.active}</strong>
          <small>
            {state.mode === "automatic" ? "Equipe automática" : "Atendimento interativo"}
          </small>
        </article>
        <article className="stat-card">
          <span>Atendimentos concluídos</span>
          <strong>{state.metrics.completed}</strong>
          <small>Contas encerradas no treinamento</small>
        </article>
      </div>
      {admin && state.id && (
        <section className="panel ops-section">
          <div className="ops-simulation-controls">
            <Field label="Velocidade do cenário">
              <select
                disabled={busy}
                value={state.speed}
                onChange={(e) => void control({ speed: Number(e.target.value) })}
              >
                <option value={1}>1× tempo normal</option>
                <option value={2}>2× acelerado</option>
                <option value={5}>5× acelerado</option>
              </select>
            </Field>
            <label className="check">
              <input
                disabled={busy}
                type="checkbox"
                checked={state.config.autoKitchen}
                onChange={(e) => void control({ autoKitchen: e.target.checked })}
              />{" "}
              Cozinha automática
            </label>
            <label className="check">
              <input
                disabled={busy}
                type="checkbox"
                checked={state.config.autoCashier}
                onChange={(e) => void control({ autoCashier: e.target.checked })}
              />{" "}
              Caixa automático
            </label>
          </div>
          <p className="muted">
            Com automações desativadas, entre com os perfis de cozinha e caixa para
            participar. O cenário continua enquanto o navegador estiver fechado.
          </p>
        </section>
      )}
      <nav className="ops-tabs" aria-label="Visualização do salão">
        <button
          className={`button ${view === "map" ? "primary" : "subtle"}`}
          aria-pressed={view === "map"}
          onClick={() => setView("map")}
        >
          Mapa de mesas
        </button>
        <button
          className={`button ${view === "list" ? "primary" : "subtle"}`}
          aria-pressed={view === "list"}
          onClick={() => setView("list")}
        >
          Lista acessível
        </button>
        <Link className="button subtle" to="/mesas">
          Atendimento e contas
        </Link>
        {(admin || auth?.user.role === "kitchen") && (
          <Link className="button subtle" to="/cozinha">
            <ChefHat size={16} /> Cozinha
          </Link>
        )}
      </nav>
      <div className="ops-simulation-layout">
        <section className="panel ops-section">
          <div className="section-heading">
            <h2>Salão · {data.tables.length} mesas</h2>
            <span className="badge">
              {active.filter((g) => g.status === "requesting").length} chamadas
            </span>
          </div>
          {view === "map" ? (
            <div className="ops-floor">
              {data.tables.map((table) => {
                const g = active.find((item) => item.tableId === table.id);
                return (
                  <article
                    className={`ops-floor-table ${g ? `group-${g.status}` : ""}`}
                    key={table.id}
                  >
                    <TableAttentionBadge tableId={table.id} />
                    <div className="ops-chair-row" aria-hidden="true">
                      {Array.from({ length: Math.min(g?.size || 2, 4) }).map((_, i) => (
                        <span
                          className={g ? "ops-person occupied" : "ops-person"}
                          key={i}
                        />
                      ))}
                    </div>
                    <div className="ops-table-top">
                      <Armchair size={25} />
                      <strong>{table.name}</strong>
                      <small>{g ? `${g.size} pessoas` : "Disponível"}</small>
                    </div>
                    <span className="ops-floor-status">
                      {g ? labels[g.status] : "Aguardando clientes"}
                    </span>
                    {g?.waiterId && <small className="muted">Garçom atribuído</small>}
                    {g?.error && (
                      <p className="ops-warning" role="status">
                        {g.error}
                      </p>
                    )}
                    {g && g.status === "requesting" && canServe && (
                      <button
                        disabled={
                          busy || (!!g.waiterId && g.waiterId !== auth?.user.id && !admin)
                        }
                        className="button primary"
                        onClick={() => void attend(g)}
                      >
                        Atender mesa
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <caption className="sr-only">
                  Grupos de clientes e seus atendimentos
                </caption>
                <thead>
                  <tr>
                    <th>Mesa</th>
                    <th>Grupo</th>
                    <th>Etapa</th>
                    <th>Atendimento</th>
                  </tr>
                </thead>
                <tbody>
                  {active.map((g) => (
                    <tr key={g.id}>
                      <td>{g.tableId ? `Mesa ${g.tableId}` : "Fila de espera"}</td>
                      <td>{g.size} pessoas</td>
                      <td>
                        {labels[g.status]}
                        {g.error && <small className="ops-warning">{g.error}</small>}
                      </td>
                      <td>
                        {g.status === "requesting" && canServe ? (
                          <button
                            className="button primary"
                            disabled={
                              busy ||
                              (!!g.waiterId && g.waiterId !== auth?.user.id && !admin)
                            }
                            onClick={() => void attend(g)}
                          >
                            Atender mesa {g.tableId}
                          </button>
                        ) : g.waiterId ? (
                          "Garçom atribuído"
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!active.length && <Empty>Nenhum grupo em atendimento.</Empty>}
            </div>
          )}
          {state.status === "idle" && (
            <Empty>
              {admin
                ? "Configure e inicie um cenário para receber os primeiros clientes."
                : "Aguarde o administrador iniciar o cenário."}
            </Empty>
          )}
        </section>
        <aside className="panel ops-section">
          <h2>Acontecimentos</h2>
          <p className="muted">Linha do tempo do cenário</p>
          <ol className="ops-timeline">
            {state.events
              .slice(-30)
              .reverse()
              .map((e) => (
                <li key={e.id} className={e.type === "error" ? "ops-warning" : ""}>
                  <time>{new Date(e.virtualTime).toLocaleTimeString("pt-BR")}</time>
                  <p>{e.message}</p>
                </li>
              ))}
          </ol>
          {!state.events.length && <Empty>Os eventos aparecerão aqui.</Empty>}
          <details>
            <summary>Fila de espera</summary>
            {active
              .filter((g) => g.status === "waiting")
              .map((g) => (
                <p key={g.id}>Grupo de {g.size} pessoas</p>
              ))}
            {!state.metrics.waiting && <p className="muted">Nenhum grupo aguardando.</p>}
          </details>
        </aside>
      </div>
      {setup && (
        <Modal title="Configurar cenário de treinamento" onClose={() => setSetup(false)}>
          <Form
            label="Iniciar simulação"
            onSubmit={async (form) => {
              await mutate("/simulation/start", {
                mode: str(form, "mode"),
                speed: Number(str(form, "speed")),
                arrivalSeconds: Number(str(form, "arrival")),
                preparationSeconds: Number(str(form, "preparation")),
                diningSeconds: Number(str(form, "dining")),
                maxGroups: Number(str(form, "maxGroups")),
                seed: Number(str(form, "seed")),
                autoKitchen: form.has("autoKitchen"),
                autoCashier: form.has("autoCashier"),
                scenario: str(form, "scenario"),
              });
              setSetup(false);
              await refresh();
              notify("Cenário iniciado no ambiente de treinamento.");
            }}
          >
            <Field label="Modo de atendimento">
              <select name="mode" defaultValue={state.config.mode}>
                <option value="interactive">
                  Interativo — garçom confirma os pedidos
                </option>
                <option value="automatic">Automático — equipe simulada</option>
              </select>
            </Field>
            <Field label="Cenário">
              <select name="scenario" defaultValue="normal">
                <option value="normal">Atendimento normal</option>
                <option value="simultaneous">Pedidos simultâneos</option>
                <option value="partial-cancellation">Cancelamento parcial</option>
                <option value="kitchen-failure">Falha da cozinha virtual</option>
                <option value="shortage">Falta de ingredientes</option>
              </select>
            </Field>
            <div className="ops-form-grid">
              <Field label="Velocidade inicial">
                <select name="speed" defaultValue="1">
                  <option value="1">1×</option>
                  <option value="2">2×</option>
                  <option value="5">5×</option>
                </select>
              </Field>
              <Field label="Semente do cenário">
                <input
                  name="seed"
                  type="number"
                  step="1"
                  min="1"
                  max="2147483647"
                  defaultValue={state.config.seed}
                  required
                />
              </Field>
              <Field label="Intervalo de chegadas (s)">
                <input
                  name="arrival"
                  type="number"
                  min="1"
                  max="3600"
                  defaultValue={state.config.arrivalSeconds}
                  required
                />
              </Field>
              <Field label="Tempo de preparo (s)">
                <input
                  name="preparation"
                  type="number"
                  min="1"
                  max="3600"
                  defaultValue={state.config.preparationSeconds}
                  required
                />
              </Field>
              <Field label="Tempo de consumo (s)">
                <input
                  name="dining"
                  type="number"
                  min="1"
                  max="3600"
                  defaultValue={state.config.diningSeconds}
                  required
                />
              </Field>
              <Field label="Limite de grupos">
                <input
                  name="maxGroups"
                  type="number"
                  min="1"
                  max="100"
                  defaultValue={state.config.maxGroups}
                  required
                />
              </Field>
            </div>
            <label className="check">
              <input
                name="autoKitchen"
                type="checkbox"
                defaultChecked={state.config.autoKitchen}
              />{" "}
              Automatizar preparo e entrega
            </label>
            <label className="check">
              <input
                name="autoCashier"
                type="checkbox"
                defaultChecked={state.config.autoCashier}
              />{" "}
              Automatizar pagamentos simulados e fechamento
            </label>
            <p className="muted">
              Tempos em segundos virtuais. O servidor guarda o cenário e o recupera
              pausado após reinicialização.
            </p>
          </Form>
        </Modal>
      )}
      {confirmation && (
        <Modal
          title={
            confirmation === "reset"
              ? "Reiniciar dados de treinamento?"
              : "Encerrar cenário?"
          }
          onClose={() => setConfirmation(null)}
        >
          <Form
            danger
            label={
              confirmation === "reset"
                ? "Confirmar reinicialização"
                : "Encerrar simulação"
            }
            onSubmit={async () => {
              await api("/simulation/control", {
                method: "POST",
                body: JSON.stringify({ action: confirmation }),
              });
              setConfirmation(null);
              await refresh();
            }}
          >
            <p>
              {confirmation === "reset"
                ? "O progresso deste ambiente simulado será substituído pelo cenário inicial. O banco operacional permanece independente."
                : "Novas ações automáticas serão encerradas. O histórico de treinamento será preservado."}
            </p>
          </Form>
        </Modal>
      )}
      {group && (
        <Modal title={`Atender mesa ${group.tableId}`} onClose={() => setGroup(null)}>
          <Form
            label="Confirmar pedido dos clientes"
            onSubmit={async (form) => {
              const items = rows.filter((i) => i.quantity > 0);
              if (!items.length)
                throw new Error("O pedido precisa de ao menos um produto.");
              await mutate(
                `/simulation/groups/${group.id}/serve`,
                { items, notes: str(form, "notes") },
                "POST",
                `simulation-serve-${group.id}`,
              );
              setGroup(null);
              await refresh();
              notify("Pedido confirmado e encaminhado à cozinha simulada.");
            }}
          >
            <p className="muted">
              Revise a solicitação dos clientes. A disponibilidade é validada ao
              confirmar.
            </p>
            {rows.map((row, index) => (
              <div key={index} className="ops-form-grid">
                <Field label={`Produto solicitado ${index + 1}`}>
                  <select
                    value={row.productId}
                    onChange={(e) =>
                      setRows((old) =>
                        old.map((r, i) =>
                          index === i ? { ...r, productId: Number(e.target.value) } : r,
                        ),
                      )
                    }
                  >
                    {data.products
                      .filter((p) => p.active && p.available)
                      .map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Quantidade solicitada">
                  <input
                    type="number"
                    min="0"
                    max="99"
                    value={row.quantity}
                    onChange={(e) =>
                      setRows((old) =>
                        old.map((r, i) =>
                          index === i ? { ...r, quantity: Number(e.target.value) } : r,
                        ),
                      )
                    }
                  />
                </Field>
              </div>
            ))}
            <button
              type="button"
              className="button subtle"
              onClick={() => {
                const product = data.products.find(
                  (p) =>
                    p.active && p.available && !rows.some((r) => r.productId === p.id),
                );
                if (product)
                  setRows((old) => [...old, { productId: product.id, quantity: 1 }]);
              }}
            >
              Adicionar produto
            </button>
            <Field label="Observações para cozinha">
              <textarea name="notes" maxLength={500} />
            </Field>
          </Form>
        </Modal>
      )}
    </>
  );
}

export function SimulationPage() {
  return SIMULATION ? <SimulationRoom /> : <TrainingLanding />;
}
