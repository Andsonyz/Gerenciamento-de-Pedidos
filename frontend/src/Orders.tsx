import { useEffect, useState } from "react";
import { Plus, Minus, ShoppingBag, Send, Trash2 } from "lucide-react";
import type { DiningTable, PremiumOrder } from "@restaurante/shared";
import { useStore } from "./state";
import { Badge, Empty, Field, Form, Heading, Modal, str } from "./components";
import { dateTime, money } from "./api";
import { tabScope } from "./operations";

interface Draft {
  quantities: Record<number, number>;
  notes: string;
}
export function Composer({
  table,
  onClose,
}: {
  table: DiningTable;
  onClose: () => void;
}) {
  const { auth, data, mutate, notify, pending } = useStore();
  const scope = tabScope();
  const key = `mesa.draft.v3.${auth!.user.id}.${table.id}.${table.sessionId}.${scope}`;
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const value: unknown = JSON.parse(
        localStorage.getItem(key) || '{"quantities":{},"notes":""}',
      );
      if (
        !value ||
        typeof value !== "object" ||
        !("notes" in value) ||
        typeof value.notes !== "string" ||
        !("quantities" in value) ||
        !value.quantities ||
        typeof value.quantities !== "object" ||
        !Object.entries(value.quantities).every(
          ([id, quantity]) =>
            /^\d+$/.test(id) &&
            typeof quantity === "number" &&
            Number.isInteger(quantity) &&
            quantity >= 0 &&
            quantity <= 99,
        )
      )
        throw new Error("Rascunho inválido.");
      return value as Draft;
    } catch {
      return { quantities: {}, notes: "" };
    }
  });
  const [category, setCategory] = useState("Todos");
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(draft));
  }, [key, draft]);
  const products = data.products.filter((product) => product.active);
  const chosen = products.filter((product) => (draft.quantities[product.id] || 0) > 0);
  const total = chosen.reduce(
    (sum, product) => sum + product.priceCents * (draft.quantities[product.id] || 0),
    0,
  );
  const count = chosen.reduce(
    (sum, product) => sum + (draft.quantities[product.id] || 0),
    0,
  );
  const uncertain = pending.some(
    (operation) =>
      operation.key === `order:${table.sessionId}` && operation.tabId === scope,
  );
  function quantity(id: number, delta: number) {
    setDraft((previous) => ({
      ...previous,
      quantities: {
        ...previous.quantities,
        [id]: Math.max(0, Math.min(99, (previous.quantities[id] || 0) + delta)),
      },
    }));
  }
  return (
    <Modal title={`Novo pedido · ${table.name}`} onClose={onClose}>
      <div className="composer">
        <div>
          <input
            aria-label="Buscar no cardápio"
            placeholder="Buscar no cardápio…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="category-tabs">
            {["Todos", ...new Set(products.map((product) => product.category))].map(
              (name) => (
                <button
                  key={name}
                  className={category === name ? "chip active" : "chip"}
                  onClick={() => setCategory(name)}
                >
                  {name}
                </button>
              ),
            )}
          </div>
          <div className="menu-list">
            {products
              .filter(
                (product) =>
                  (category === "Todos" || product.category === category) &&
                  product.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
              )
              .map((product) => (
                <div className="menu-item" key={product.id}>
                  <div className="product-monogram">{product.name.slice(0, 1)}</div>
                  <div className="menu-item-info">
                    <strong>{product.name}</strong>
                    <small>{product.category}</small>
                    <span className="gold">{money(product.priceCents)}</span>
                    {!product.available && (
                      <small className="error-text">Indisponível</small>
                    )}
                  </div>
                  <div className="quantity">
                    <button
                      aria-label={`Remover ${product.name}`}
                      className="icon-button"
                      disabled={uncertain || !draft.quantities[product.id]}
                      onClick={() => quantity(product.id, -1)}
                    >
                      <Minus size={15} />
                    </button>
                    <span>{draft.quantities[product.id] || 0}</span>
                    <button
                      aria-label={`Adicionar ${product.name}`}
                      disabled={
                        uncertain ||
                        !product.available ||
                        (draft.quantities[product.id] || 0) >= 99
                      }
                      className="icon-button"
                      onClick={() => quantity(product.id, 1)}
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                </div>
              ))}
            {!products.length && <Empty>O cardápio ainda não tem produtos.</Empty>}
          </div>
        </div>
        <aside className="cart">
          <p className="eyebrow">SEU PEDIDO</p>
          <h3>
            <ShoppingBag size={19} /> {count} {count === 1 ? "item" : "itens"}
          </h3>
          {chosen.map((product) => (
            <div className="line" key={product.id}>
              <span>
                {draft.quantities[product.id]} × {product.name}
              </span>
              <strong>
                {money((draft.quantities[product.id] || 0) * product.priceCents)}
              </strong>
            </div>
          ))}
          <Field label="Observações para a cozinha">
            <textarea
              maxLength={500}
              disabled={uncertain}
              placeholder="Ponto da carne, alergias, sem cebola…"
              value={draft.notes}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  notes: event.target.value,
                }))
              }
            />
          </Field>
          <div className="line total">
            <span>Total</span>
            <strong>{money(total)}</strong>
          </div>
          <p className="muted small">
            Rascunho salvo neste dispositivo. O pedido só é confirmado após o envio.
          </p>
          {uncertain && (
            <div className="alert">
              Há um envio aguardando confirmação. A nova tentativa usa os mesmos itens e
              identificador.
            </div>
          )}
          {confirm ? (
            <div className="confirm-box">
              <strong>Confirmar envio para {table.name}?</strong>
              <Form
                label={uncertain ? "Consultar / repetir envio" : "Confirmar pedido"}
                onSubmit={async () => {
                  await mutate(
                    "/orders",
                    {
                      tableId: table.id,
                      sessionId: table.sessionId,
                      items: chosen.map((product) => ({
                        productId: product.id,
                        quantity: draft.quantities[product.id],
                      })),
                      notes: draft.notes,
                    },
                    "POST",
                    `order:${table.sessionId}`,
                  );
                  localStorage.removeItem(key);
                  notify("Pedido confirmado e enviado à cozinha.");
                  onClose();
                }}
              >
                <p className="small muted">
                  Confira itens, quantidades e observações antes de enviar.
                </p>
              </Form>
              <button className="button ghost" onClick={() => setConfirm(false)}>
                Voltar ao rascunho
              </button>
            </div>
          ) : (
            <button
              className="button primary"
              disabled={!count && !uncertain}
              onClick={() => setConfirm(true)}
            >
              <Send size={17} /> Revisar e enviar
            </button>
          )}
          <button
            className="button ghost"
            disabled={uncertain}
            onClick={() => setDraft({ quantities: {}, notes: "" })}
          >
            <Trash2 size={15} /> Limpar rascunho
          </button>
        </aside>
      </div>
    </Modal>
  );
}
export function CancellationDialog({
  order,
  onClose,
}: {
  order: PremiumOrder;
  onClose: () => void;
}) {
  const { auth, mutate, notify } = useStore();
  const direct = auth!.user.role !== "waiter";
  const advanced = order.status === "preparing" || order.status === "ready";
  return (
    <Modal
      title={`${direct ? "Cancelar itens" : "Solicitar cancelamento"} · #${order.number}`}
      onClose={onClose}
    >
      <Form
        label={direct ? "Confirmar cancelamento" : "Enviar solicitação"}
        danger
        onSubmit={async (form) => {
          const items = order.items
            .map((item) => ({
              itemId: item.id,
              quantity: Number(form.get(item.id)),
            }))
            .filter((item) => item.quantity > 0);
          if (!items.length) throw new Error("Escolha ao menos um item.");
          await mutate(
            `/orders/${order.id}/${direct ? "cancel" : "cancellation-requests"}`,
            {
              items,
              reason: str(form, "reason"),
              acknowledged: form.get("acknowledged") === "on",
            },
            "POST",
            `cancel:${order.id}`,
          );
          notify(
            direct ? "Cancelamento registrado." : "Solicitação enviada para aprovação.",
          );
          onClose();
        }}
      >
        <p className="muted">
          Selecione a quantidade a cancelar. Esta ação registra um comprovante para a
          cozinha.
        </p>
        {order.items
          .filter((item) => item.quantity > item.cancelledQuantity)
          .map((item) => (
            <Field
              key={item.id}
              label={`${item.name} · disponível: ${item.quantity - item.cancelledQuantity}`}
            >
              <input
                name={item.id}
                type="number"
                min="0"
                max={item.quantity - item.cancelledQuantity}
                step="1"
                defaultValue="0"
                required
              />
            </Field>
          ))}
        <Field label="Justificativa">
          <textarea name="reason" required minLength={3} maxLength={500} />
        </Field>
        {advanced && (
          <label className="check">
            <input type="checkbox" name="acknowledged" required /> Reconheço que este
            pedido já está em preparo ou pronto e confirmo o cancelamento.
          </label>
        )}
      </Form>
    </Modal>
  );
}
export function OrdersPage() {
  const { data, auth } = useStore();
  const [cancel, setCancel] = useState<PremiumOrder | null>(null);
  const [filter, setFilter] = useState("all");
  const orders = data.orders.filter(
    (order) => filter === "all" || order.status === filter,
  );
  return (
    <>
      <Heading
        eyebrow="ACOMPANHAMENTO"
        title={auth!.user.role === "waiter" ? "Meus pedidos" : "Pedidos do salão"}
        description="Da confirmação à entrega, cada etapa à vista."
      />
      <div className="category-tabs">
        {[
          ["all", "Todos"],
          ["received", "Recebidos"],
          ["preparing", "Em preparo"],
          ["ready", "Prontos"],
          ["delivered", "Entregues"],
          ["cancelled", "Cancelados"],
        ].map(([value, label]) => (
          <button
            key={value}
            className={`chip ${filter === value ? "active" : ""}`}
            onClick={() => setFilter(value!)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="orders-grid">
        {orders.map((order) => (
          <article className="panel order-card" key={order.id}>
            <div className="line">
              <p className="eyebrow">PEDIDO #{String(order.number).padStart(3, "0")}</p>
              <Badge status={order.status} />
            </div>
            <h3>Mesa {String(order.tableId).padStart(2, "0")}</h3>
            <p className="muted small">
              {dateTime(order.createdAt)} · {order.userName}
            </p>
            <div className="order-items">
              {order.items.map((item) => (
                <div
                  className={`line ${item.quantity === item.cancelledQuantity ? "cancelled-item" : ""}`}
                  key={item.id}
                >
                  <span>
                    {item.quantity - item.cancelledQuantity} × {item.name}
                    {item.cancelledQuantity > 0 && (
                      <small> ({item.cancelledQuantity} cancelado)</small>
                    )}
                  </span>
                  <span>
                    {money(item.priceCents * (item.quantity - item.cancelledQuantity))}
                  </span>
                </div>
              ))}
            </div>
            {order.notes && <p className="order-notes">{order.notes}</p>}
            {order.status !== "cancelled" && (
              <button className="button ghost small" onClick={() => setCancel(order)}>
                {auth!.user.role === "waiter"
                  ? "Solicitar cancelamento"
                  : "Cancelar itens"}
              </button>
            )}
          </article>
        ))}
      </div>
      {!orders.length && <Empty>Nenhum pedido nesta etapa.</Empty>}
      <section className="panel section-gap">
        <h2>Solicitações de cancelamento</h2>
        {!data.cancellations.length && <Empty>Nenhuma solicitação registrada.</Empty>}
        {data.cancellations.map((request) => (
          <div className="request-row" key={request.id}>
            <div>
              <strong>
                Pedido #{request.orderNumber} · Mesa {request.tableId}
              </strong>
              <p className="muted small">{request.reason}</p>
              <p className="small">
                {request.items
                  .map((item) => `${item.quantity} × ${item.name}`)
                  .join(" · ")}
              </p>
              {request.resolutionReason && (
                <p className="small">Resposta: {request.resolutionReason}</p>
              )}
            </div>
            <Badge status={request.status} />
            {auth!.user.role !== "waiter" && request.status === "pending" && (
              <ResolveRequest id={request.id} />
            )}
          </div>
        ))}
      </section>
      {cancel && <CancellationDialog order={cancel} onClose={() => setCancel(null)} />}
    </>
  );
}
function ResolveRequest({ id }: { id: string }) {
  const { mutate, notify } = useStore();
  const [show, setShow] = useState(false);
  return (
    <>
      <button className="button" onClick={() => setShow(true)}>
        Analisar
      </button>
      {show && (
        <Modal title="Analisar cancelamento" onClose={() => setShow(false)}>
          <Form
            label="Registrar decisão"
            onSubmit={async (form) => {
              await mutate(`/cancellation-requests/${id}/resolve`, {
                approve: form.get("decision") === "approve",
                reason: str(form, "reason"),
                acknowledged: form.get("acknowledged") === "on",
              });
              notify("Decisão registrada.");
              setShow(false);
            }}
          >
            <Field label="Decisão">
              <select name="decision">
                <option value="approve">Aprovar cancelamento</option>
                <option value="reject">Rejeitar solicitação</option>
              </select>
            </Field>
            <Field label="Justificativa">
              <textarea name="reason" required minLength={3} />
            </Field>
            <label className="check">
              <input type="checkbox" name="acknowledged" required /> Conferi os itens e a
              situação de preparo com a cozinha.
            </label>
          </Form>
        </Modal>
      )}
    </>
  );
}
