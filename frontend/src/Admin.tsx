import { useState } from "react";
import {
  ArrowUpRight,
  Armchair,
  Banknote,
  ChefHat,
  Clock3,
  Plus,
  ReceiptText,
  ShieldCheck,
  Users,
  UtensilsCrossed,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { CatalogProduct, User } from "@restaurante/shared";
import { useStore } from "./state";
import {
  Badge,
  Empty,
  Field,
  Form,
  Heading,
  Modal,
  statusLabel,
  str,
} from "./components";
import { dateTime, money, parseCents } from "./api";
const auditLabels: Record<string, string> = {
  "auth.login": "Acesso ao sistema",
  "user.saved": "Acesso de funcionário atualizado",
  "migration.premium": "Dados anteriores importados",
  "settings.updated": "Configurações atualizadas",
  "category.saved": "Categoria cadastrada",
  "product.saved": "Produto atualizado",
  "table.opened": "Atendimento aberto",
  "table.status": "Situação da mesa alterada",
  "table.close_requested": "Fechamento solicitado",
  "session.closed": "Atendimento encerrado",
  "order.created": "Pedido recebido",
  "order.status": "Etapa de preparo atualizada",
  "order.cancelled": "Itens cancelados",
  "cancellation.requested": "Cancelamento solicitado",
  "cancellation.resolved": "Solicitação de cancelamento analisada",
  "bill.adjusted": "Valores da conta ajustados",
  "payment.registered": "Pagamento registrado",
  "payment.refunded": "Estorno manual registrado",
  "print.updated": "Situação da comanda atualizada",
  "print.reprinted": "Reimpressão simulada solicitada",
};
function auditSummary(detail: string) {
  try {
    const value = JSON.parse(detail) as Record<string, unknown>;
    if (typeof value.reason === "string") return value.reason;
    if (typeof value.amountCents === "number") return money(value.amountCents);
    if (typeof value.number === "number") return `Pedido #${value.number}`;
    if (typeof value.username === "string") return `Usuário ${value.username}`;
    if (typeof value.tableId === "number")
      return `Mesa ${String(value.tableId).padStart(2, "0")}`;
    if (typeof value.after === "string")
      return statusLabel[value.after] ?? "Situação atualizada";
    return "Registro preservado no histórico.";
  } catch {
    return "Registro preservado no histórico.";
  }
}
export function DashboardPage() {
  const { data, auth } = useStore();
  const d = data.dashboard;
  if (!d) return <Empty>Carregando indicadores do restaurante…</Empty>;
  const stats = [
    {
      label: "Recebido hoje",
      value: money(d.revenueTodayCents),
      icon: Banknote,
      note: "Pagamentos líquidos registrados",
    },
    {
      label: "Mesas ocupadas",
      value: `${d.occupiedTables} / ${d.totalTables}`,
      icon: Armchair,
      note: `${d.availableTables} disponíveis no salão`,
    },
    {
      label: "Em preparo",
      value: d.preparingOrders,
      icon: ChefHat,
      note: `${d.readyOrders} pedidos prontos`,
    },
    {
      label: "Aguardando pagamento",
      value: d.awaitingPayment,
      icon: ReceiptText,
      note: "Atendimentos para encerrar",
    },
  ];
  return (
    <>
      <Heading
        eyebrow="VISÃO GERAL"
        title="Um bom serviço começa aqui."
        description={`Bem-vindo, ${auth!.user.name.split(" ")[0]}. Acompanhe o movimento do restaurante.`}
      >
        <Link className="button primary" to="/mesas">
          <Plus size={17} /> Novo atendimento
        </Link>
      </Heading>
      <div className="stats-grid">
        {stats.map((stat) => (
          <article className="stat-card" key={stat.label}>
            <div className="line">
              <span>{stat.label}</span>
              <span className="stat-icon">
                <stat.icon size={20} />
              </span>
            </div>
            <strong>{stat.value}</strong>
            <small>{stat.note}</small>
          </article>
        ))}
      </div>
      <div className="dashboard-columns">
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">SALÃO</p>
              <h2>Visão das mesas</h2>
            </div>
            <Link className="text-link" to="/mesas">
              Ver salão <ArrowUpRight size={15} />
            </Link>
          </div>
          <div className="mini-tables">
            {data.tables.map((table) => (
              <Link
                key={table.id}
                to="/mesas"
                className={`mini-table table-${table.status}`}
              >
                <Armchair size={20} />
                <strong>{table.name}</strong>
                <span className={`dot ${table.status}`} />
              </Link>
            ))}
          </div>
          <div className="legend">
            <span>
              <i className="dot available" /> Disponível
            </span>
            <span>
              <i className="dot occupied" /> Ocupada
            </span>
            <span>
              <i className="dot awaiting_payment" /> Pagamento
            </span>
          </div>
        </section>
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">ATENÇÃO AO SERVIÇO</p>
              <h2>Agora no restaurante</h2>
            </div>
            <Clock3 size={21} className="gold" />
          </div>
          <div className="service-stat">
            <span>
              <ChefHat size={19} /> Pedidos prontos para sair
            </span>
            <strong>{d.readyOrders}</strong>
          </div>
          <div className="service-stat">
            <span>
              <ShieldCheck size={19} /> Cancelamentos pendentes
            </span>
            <strong>{d.pendingCancellations}</strong>
          </div>
          <div className="service-stat">
            <span>
              <ReceiptText size={19} /> Comandas na fila
            </span>
            <strong>{d.pendingPrintJobs}</strong>
          </div>
          <div className="service-stat">
            <span>
              <UtensilsCrossed size={19} /> Pedidos cancelados
            </span>
            <strong>{d.cancelledOrders}</strong>
          </div>
          <Link className="button full-width" to="/pedidos">
            Acompanhar pedidos <ArrowUpRight size={16} />
          </Link>
        </section>
      </div>
      <section className="panel section-gap">
        <div className="section-heading">
          <div>
            <p className="eyebrow">ACONTECEU POR AQUI</p>
            <h2>Atividade recente</h2>
          </div>
          {auth!.user.role === "admin" && (
            <Link className="text-link" to="/auditoria">
              Ver auditoria <ArrowUpRight size={15} />
            </Link>
          )}
        </div>
        {d.recent.map((entry) => (
          <div className="activity-row" key={entry.id}>
            <span className="activity-icon">
              <Clock3 size={16} />
            </span>
            <div>
              <strong>{auditLabels[entry.action] ?? "Operação registrada"}</strong>
              <p className="muted small">
                {entry.userName} · {auditSummary(entry.detail)}
              </p>
            </div>
            <time>{dateTime(entry.createdAt)}</time>
          </div>
        ))}
        {!d.recent.length && <Empty>As primeiras movimentações aparecerão aqui.</Empty>}
      </section>
    </>
  );
}
export function CatalogPage() {
  const { data, mutate, notify } = useStore();
  const [editing, setEditing] = useState<CatalogProduct | "new" | null>(null);
  const [category, setCategory] = useState(false);
  const [search, setSearch] = useState("");
  const product = editing && editing !== "new" ? editing : null;
  return (
    <>
      <Heading
        eyebrow="CURADORIA DO CARDÁPIO"
        title="Catálogo de produtos"
        description="Preços, categorias e disponibilidade em um só lugar."
      >
        <button className="button" onClick={() => setCategory(true)}>
          Nova categoria
        </button>
        <button className="button primary" onClick={() => setEditing("new")}>
          <Plus size={17} /> Adicionar produto
        </button>
      </Heading>
      <input
        className="search-field"
        aria-label="Buscar produto"
        placeholder="Buscar produto ou categoria…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th>Produto</th>
              <th>Categoria</th>
              <th>Preço</th>
              <th>Disponibilidade</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.products
              .filter((item) =>
                `${item.name} ${item.category}`
                  .toLocaleLowerCase()
                  .includes(search.toLocaleLowerCase()),
              )
              .map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.name}</strong>
                    {!item.active && <small className="error-text">Inativo</small>}
                  </td>
                  <td>{item.category}</td>
                  <td>{money(item.priceCents)}</td>
                  <td>
                    <Badge
                      status={
                        !item.active
                          ? "unavailable"
                          : item.available
                            ? "available"
                            : "unavailable"
                      }
                    />
                  </td>
                  <td>
                    <button className="button ghost" onClick={() => setEditing(item)}>
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {!data.products.length && <Empty>Cadastre o primeiro produto do cardápio.</Empty>}
      </div>
      {editing && (
        <Modal
          title={product ? "Editar produto" : "Adicionar produto"}
          onClose={() => setEditing(null)}
        >
          <Form
            onSubmit={async (form) => {
              await mutate(
                product ? `/products/${product.id}` : "/products",
                {
                  name: str(form, "name"),
                  category: str(form, "category"),
                  priceCents: parseCents(str(form, "price")),
                  active: form.get("active") === "on",
                  available: form.get("available") === "on",
                },
                product ? "PATCH" : "POST",
              );
              notify("Produto salvo.");
              setEditing(null);
            }}
          >
            <Field label="Nome">
              <input name="name" defaultValue={product?.name} required maxLength={120} />
            </Field>
            <Field label="Categoria">
              <select name="category" defaultValue={product?.category} required>
                <option value="">Selecione uma categoria</option>
                {data.categories.map((item) => (
                  <option key={item.id}>{item.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Preço (R$)">
              <input
                name="price"
                inputMode="decimal"
                defaultValue={
                  product ? (product.priceCents / 100).toFixed(2).replace(".", ",") : ""
                }
                required
              />
            </Field>
            <label className="check">
              <input
                name="active"
                type="checkbox"
                defaultChecked={product?.active ?? true}
              />{" "}
              Produto ativo no catálogo
            </label>
            <label className="check">
              <input
                name="available"
                type="checkbox"
                defaultChecked={product?.available ?? true}
              />{" "}
              Disponível para novos pedidos
            </label>
          </Form>
        </Modal>
      )}
      {category && (
        <Modal title="Nova categoria" onClose={() => setCategory(false)}>
          <Form
            onSubmit={async (form) => {
              await mutate("/categories", { name: str(form, "name") });
              notify("Categoria criada.");
              setCategory(false);
            }}
          >
            <Field label="Nome da categoria">
              <input name="name" required maxLength={80} />
            </Field>
          </Form>
        </Modal>
      )}
    </>
  );
}
export function UsersPage() {
  const { data, mutate, notify } = useStore();
  const [editing, setEditing] = useState<User | "new" | null>(null);
  const user = editing && editing !== "new" ? editing : null;
  return (
    <>
      <Heading
        eyebrow="PESSOAS & PERMISSÕES"
        title="Equipe do restaurante"
        description="Acesso individual, responsabilidades bem definidas."
      >
        <button className="button primary" onClick={() => setEditing("new")}>
          <Users size={17} /> Adicionar usuário
        </button>
      </Heading>
      <div className="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Usuário</th>
              <th>Perfil</th>
              <th>Acesso</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.users.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.name}</strong>
                </td>
                <td>{item.username}</td>
                <td>{statusLabel[item.role]}</td>
                <td>
                  <Badge status={item.active ? "available" : "unavailable"} />
                </td>
                <td>
                  <button className="button ghost" onClick={() => setEditing(item)}>
                    Editar acesso
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <Modal
          title={user ? "Editar usuário" : "Novo usuário"}
          onClose={() => setEditing(null)}
        >
          <Form
            onSubmit={async (form) => {
              const password = str(form, "password");
              await mutate(
                user ? `/users/${user.id}` : "/users",
                {
                  name: str(form, "name"),
                  username: str(form, "username"),
                  role: str(form, "role"),
                  active: form.get("active") === "on",
                  ...(password ? { password } : {}),
                },
                user ? "PATCH" : "POST",
              );
              notify("Acesso atualizado.");
              setEditing(null);
            }}
          >
            <Field label="Nome completo">
              <input name="name" defaultValue={user?.name} required maxLength={100} />
            </Field>
            <Field label="Nome de usuário">
              <input
                name="username"
                defaultValue={user?.username}
                autoComplete="off"
                required
                maxLength={80}
              />
            </Field>
            <Field label="Perfil">
              <select name="role" defaultValue={user?.role || "waiter"}>
                {["admin", "cashier", "waiter", "kitchen"].map((role) => (
                  <option key={role} value={role}>
                    {statusLabel[role]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={user ? "Redefinir senha (opcional)" : "Senha inicial"}>
              <input
                name="password"
                type="password"
                minLength={12}
                required={!user}
                autoComplete="new-password"
              />
              <small>
                Use ao menos 12 caracteres. Compartilhe a senha por um meio seguro.
              </small>
            </Field>
            <label className="check">
              <input
                name="active"
                type="checkbox"
                defaultChecked={user?.active ?? true}
              />{" "}
              Acesso ativo
            </label>
            {user && (
              <p className="muted small">Desativar revoga as sessões deste usuário.</p>
            )}
          </Form>
        </Modal>
      )}
    </>
  );
}
export function AuditPage() {
  const { data } = useStore();
  const [search, setSearch] = useState("");
  return (
    <>
      <Heading
        eyebrow="TRANSPARÊNCIA OPERACIONAL"
        title="Auditoria"
        description="Histórico das ações, com autoria e justificativas."
      />
      <input
        className="search-field"
        aria-label="Buscar na auditoria"
        placeholder="Buscar ação, usuário ou detalhe…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Usuário</th>
              <th>Ação</th>
              <th>Detalhes</th>
            </tr>
          </thead>
          <tbody>
            {data.audit
              .filter((entry) =>
                `${entry.userName} ${auditLabels[entry.action]} ${entry.action} ${entry.detail}`
                  .toLocaleLowerCase()
                  .includes(search.toLocaleLowerCase()),
              )
              .map((entry) => (
                <tr key={entry.id}>
                  <td>{dateTime(entry.createdAt)}</td>
                  <td>{entry.userName}</td>
                  <td>
                    {auditLabels[entry.action] ?? "Operação registrada"}
                    <small>{entry.entityId}</small>
                  </td>
                  <td className="audit-detail">
                    {auditSummary(entry.detail)}
                    <details>
                      <summary>Ver registro completo</summary>
                      <pre>{entry.detail}</pre>
                    </details>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {!data.audit.length && <Empty>Nenhuma ação registrada.</Empty>}
      </div>
    </>
  );
}
export function SettingsPage() {
  const { data, mutate, notify } = useStore();
  return (
    <>
      <Heading
        eyebrow="IDENTIDADE & OPERAÇÃO"
        title="Configurações"
        description="Ajustes essenciais para o seu restaurante."
      />
      <section className="panel settings-panel">
        <h2>Seu restaurante</h2>
        <Form
          onSubmit={async (form) => {
            await mutate(
              "/settings",
              {
                name: str(form, "name"),
                otherPaymentEnabled: form.get("other") === "on",
              },
              "PATCH",
            );
            notify("Configurações salvas.");
          }}
        >
          <Field label="Nome do restaurante">
            <input
              name="name"
              defaultValue={data.settings.name}
              required
              maxLength={100}
            />
          </Field>
          <label className="check">
            <input
              name="other"
              type="checkbox"
              defaultChecked={data.settings.otherPaymentEnabled}
            />{" "}
            Habilitar a forma de pagamento “Outro”
          </label>
        </Form>
      </section>
    </>
  );
}
