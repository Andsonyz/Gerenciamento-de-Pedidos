import { Link, useSearchParams } from "react-router-dom";
import { Bell, Check, ChevronRight } from "lucide-react";
import type { AttentionType, TableAttention } from "@restaurante/shared";
import { useStore } from "./state";
import { Empty, Form, Heading } from "./components";
import { SIMULATION } from "./environment";
export const attentionLabels: Record<AttentionType, string> = {
  waiter: "Aguardando garçom",
  order: "Aguardando pedido",
  closing: "Fechamento de conta",
};
export const attentionTypes: AttentionType[] = ["waiter", "order", "closing"];
export function AttentionBadge({ item }: { item?: TableAttention }) {
  if (!item) return null;
  return (
    <span className={`attention-badge attention-${item.type}`} title={item.detail}>
      <span className="attention-exclamation" aria-hidden="true">
        !
      </span>
      <span>{attentionLabels[item.type]}</span>
    </span>
  );
}
export function TableAttentionBadge({ tableId }: { tableId: number }) {
  const { data } = useStore();
  return (
    <AttentionBadge item={data.notifications.items.find((n) => n.tableId === tableId)} />
  );
}
export function NotificationSummary() {
  const { data } = useStore();
  return (
    <section className="notification-summary" aria-label="Resumo de notificações">
      <div className="notification-summary-title">
        <Bell size={15} />
        <strong>Atendimento</strong>
        <span
          className="notification-total"
          aria-label={`${data.notifications.counts.total} mesas com pendências`}
        >
          {data.notifications.counts.total}
        </span>
      </div>
      {attentionTypes.map((type) => (
        <Link
          key={type}
          to={`/avisos?type=${type}`}
          className={`notification-summary-row attention-${type}`}
          aria-label={`${attentionLabels[type]}: ${data.notifications.counts[type]}`}
        >
          <span className="attention-exclamation" aria-hidden="true">
            !
          </span>
          <span>{attentionLabels[type]}</span>
          <strong>{data.notifications.counts[type]}</strong>
        </Link>
      ))}
    </section>
  );
}
export function NotificationBell() {
  const { data } = useStore();
  const total = data.notifications.counts.total;
  return (
    <Link
      to="/avisos"
      className="notification-bell icon-button"
      aria-label={`Notificações de atendimento: ${total} pendências`}
    >
      <Bell size={19} />
      {total > 0 && (
        <span className="notification-bell-count" aria-hidden="true">
          ! {total}
        </span>
      )}
    </Link>
  );
}
export function NotificationsPage() {
  const { data, auth, mutate, notify, connected } = useStore();
  const [params, setParams] = useSearchParams();
  const type = params.get("type");
  const items = data.notifications.items.filter((n) => !type || n.type === type);
  const canServe = auth?.user.role !== "kitchen";
  return (
    <>
      <Heading
        eyebrow="ATENÇÃO AO SALÃO"
        title="Notificações de atendimento"
        description="Pendências atualizadas em tempo real. O fechamento tem prioridade sobre os demais avisos da mesma mesa."
      />
      <p className="sr-only" role="status" aria-live="polite">
        {data.notifications.counts.total} mesas com pendências.{" "}
        {data.notifications.counts.waiter} aguardando garçom,{" "}
        {data.notifications.counts.order} aguardando pedido e{" "}
        {data.notifications.counts.closing} aguardando fechamento.
      </p>
      {!connected && (
        <p className="alert">
          Exibindo o último estado recebido. Aguardando reconexão para atualizar os
          avisos.
        </p>
      )}
      <div className="category-tabs" aria-label="Filtrar notificações">
        <button className={`chip ${!type ? "active" : ""}`} onClick={() => setParams({})}>
          Todas ({data.notifications.counts.total})
        </button>
        {attentionTypes.map((t) => (
          <button
            key={t}
            className={`chip attention-${t} ${type === t ? "active" : ""}`}
            onClick={() => setParams({ type: t })}
          >
            {attentionLabels[t]} ({data.notifications.counts[t]})
          </button>
        ))}
      </div>
      <div className="notification-list">
        {items.map((item) => (
          <article
            key={item.id}
            className={`panel notification-card attention-${item.type}`}
          >
            <div>
              <h2>{item.tableName}</h2>
              <AttentionBadge item={item} />
              <p className="muted">{item.detail}</p>
            </div>
            <div className="notification-card-actions">
              {canServe && item.type === "waiter" && (
                <Form
                  label="Atender chamado"
                  onSubmit={async () => {
                    await mutate(
                      `/tables/${item.tableId}/acknowledge-call`,
                      {},
                      "POST",
                      `attend:${item.sessionId}`,
                    );
                    notify(`Chamado de ${item.tableName} atendido.`);
                  }}
                >
                  <span className="small muted">
                    <Check size={14} /> Confirmar que o garçom iniciou o atendimento.
                  </span>
                </Form>
              )}
              <Link
                className="button"
                to={
                  canServe
                    ? `/mesas?table=${item.tableId}`
                    : SIMULATION
                      ? "/simulador"
                      : "/cozinha"
                }
              >
                Ver {canServe ? "mesa" : SIMULATION ? "salão" : "cozinha"}
                <ChevronRight size={16} />
              </Link>
            </div>
          </article>
        ))}
      </div>
      {!items.length && <Empty>Nenhuma pendência nesta categoria.</Empty>}
    </>
  );
}
