import { useState } from "react";
import { Armchair, ArrowUpRight, Plus, Printer, ReceiptText, Wallet } from "lucide-react";
import type { Bill, DiningTable, Payment } from "@restaurante/shared";
import { useStore } from "./state";
import { Badge, Empty, Field, Form, Heading, Modal, str } from "./components";
import { dateTime, money, parseCents } from "./api";
import { Composer } from "./Orders";
const amountInput = (cents: number) =>
  `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
export const paymentLabel: Record<string, string> = {
  cash: "Dinheiro",
  pix: "Pix",
  debit: "Débito",
  credit: "Crédito",
  other: "Outro",
};
export function TablesPage() {
  const { data, auth, mutate, notify } = useStore();
  const [table, setTable] = useState<DiningTable | null>(null);
  const [composer, setComposer] = useState<DiningTable | null>(null);
  const [billId, setBillId] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const waiter = auth!.user.role === "waiter";
  return (
    <>
      <Heading
        eyebrow={waiter ? "ATENDIMENTO" : "GESTÃO DO SALÃO"}
        title="Cada mesa, uma experiência."
        description="Acompanhe o salão e cuide de cada atendimento."
      />
      <div className="table-summary">
        <div>
          <span className="dot available" />{" "}
          {data.tables.filter((item) => item.status === "available").length} disponíveis
        </div>
        <div>
          <span className="dot occupied" />{" "}
          {data.tables.filter((item) => item.status === "occupied").length} ocupadas
        </div>
        <div>
          <span className="dot awaiting_payment" />{" "}
          {data.tables.filter((item) => item.status === "awaiting_payment").length}{" "}
          aguardando pagamento
        </div>
      </div>
      <div className="category-tabs">
        {[
          ["all", "Todas as mesas"],
          ["available", "Disponíveis"],
          ["occupied", "Ocupadas"],
          ["awaiting_payment", "Para fechar"],
        ].map(([value, label]) => (
          <button
            key={value}
            onClick={() => setFilter(value!)}
            className={`chip ${filter === value ? "active" : ""}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="tables-grid">
        {data.tables
          .filter((item) => filter === "all" || item.status === filter)
          .map((item) => (
            <button
              className={`table-card table-${item.status}`}
              key={item.id}
              onClick={() => {
                setTable(item);
                setOpen(false);
              }}
            >
              <div className="line">
                <span className="table-icon">
                  <Armchair size={23} />
                </span>
                <ArrowUpRight size={17} />
              </div>
              <strong>{item.name}</strong>
              <Badge status={item.status} />
              <span className="table-card-caption">
                {item.sessionId ? "Ver atendimento" : "Gerenciar mesa"}
              </span>
            </button>
          ))}
      </div>
      {!data.tables.length && <Empty>Nenhuma mesa cadastrada.</Empty>}
      {table && (
        <Modal title={table.name} onClose={() => setTable(null)}>
          <Badge status={table.status} />
          {!table.sessionId ? (
            <div className="section-gap">
              {open ? (
                <Form
                  label="Confirmar abertura"
                  onSubmit={async () => {
                    await mutate(
                      `/tables/${table.id}/open`,
                      {},
                      "POST",
                      `open:${table.id}`,
                    );
                    notify("Atendimento aberto.");
                    setTable(null);
                  }}
                >
                  <p>Confirmar um novo atendimento para {table.name}?</p>
                </Form>
              ) : (
                <button
                  className="button primary"
                  disabled={table.status === "unavailable"}
                  onClick={() => setOpen(true)}
                >
                  <Plus size={17} /> Abrir atendimento
                </button>
              )}
            </div>
          ) : (
            <div className="action-stack section-gap">
              <button
                className="button primary"
                onClick={() => {
                  setComposer(table);
                  setTable(null);
                }}
              >
                <Plus size={17} /> Adicionar pedido
              </button>
              {!waiter && (
                <button
                  className="button"
                  onClick={() => {
                    setBillId(table.sessionId);
                    setTable(null);
                  }}
                >
                  <ReceiptText size={17} /> Ver conta e receber
                </button>
              )}
              <Form
                label="Solicitar fechamento"
                onSubmit={async () => {
                  await mutate(`/sessions/${table.sessionId}/request-close`, {});
                  notify("Fechamento solicitado.");
                  setTable(null);
                }}
              >
                <p className="muted small">
                  Confirme para sinalizar ao caixa que esta mesa deseja encerrar.
                </p>
              </Form>
            </div>
          )}
          {!waiter && !table.sessionId && (
            <Form
              label="Atualizar situação"
              onSubmit={async (form) => {
                await mutate(
                  `/tables/${table.id}`,
                  { status: str(form, "status") },
                  "PATCH",
                );
                setTable(null);
              }}
            >
              <Field label="Situação da mesa">
                <select name="status" defaultValue={table.status}>
                  <option value="available">Disponível</option>
                  <option value="reserved">Reservada</option>
                  <option value="unavailable">Indisponível</option>
                </select>
              </Field>
            </Form>
          )}
        </Modal>
      )}
      {composer && (
        <Composer key={composer.id} table={composer} onClose={() => setComposer(null)} />
      )}
      {billId && <BillDialog id={billId} onClose={() => setBillId(null)} />}
    </>
  );
}
export function BillDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, auth, mutate, notify } = useStore();
  const bill = data.sessions.find((session) => session.id === id);
  const [action, setAction] = useState("");
  const [refund, setRefund] = useState<Payment | null>(null);
  const admin = auth!.user.role === "admin";
  if (!bill)
    return (
      <Modal title="Conta" onClose={onClose}>
        <Empty>Não foi possível localizar o atendimento. Atualize o salão.</Empty>
      </Modal>
    );
  return (
    <Modal
      title={`Conta · Mesa ${String(bill.tableId).padStart(2, "0")}`}
      onClose={onClose}
    >
      <div className="bill-print">
        <div className="print-only">
          <h2>{data.settings.name}</h2>
          <p>CONFERÊNCIA DE CONSUMO · NÃO FISCAL</p>
          <p>
            Mesa {bill.tableId} · {dateTime(bill.openedAt)}
          </p>
        </div>
        <div className="line">
          <Badge status={bill.status} />
          <span className="muted small">Aberta em {dateTime(bill.openedAt)}</span>
        </div>
        {bill.orders.map((order) => (
          <section className="bill-order" key={order.id}>
            <div className="line">
              <strong>Pedido #{order.number}</strong>
              <span className="muted small">{dateTime(order.createdAt)}</span>
            </div>
            {order.items.map((item) => (
              <div className="bill-item" key={item.id}>
                <span>
                  {item.quantity - item.cancelledQuantity} × {item.name}
                  {item.cancelledQuantity > 0 && (
                    <small className="error-text">
                      {" "}
                      · {item.cancelledQuantity} cancelado(s)
                    </small>
                  )}
                </span>
                <small>{money(item.priceCents)} / un.</small>
                <strong>
                  {money((item.quantity - item.cancelledQuantity) * item.priceCents)}
                </strong>
              </div>
            ))}
          </section>
        ))}
        {!bill.orders.length && <Empty>Este atendimento ainda não tem pedidos.</Empty>}
        <div className="bill-totals">
          <div className="line">
            <span>Subtotal</span>
            <span>{money(bill.subtotalCents)}</span>
          </div>
          <div className="line">
            <span>Desconto</span>
            <span>− {money(bill.discountCents)}</span>
          </div>
          <div className="line">
            <span>Serviço</span>
            <span>{money(bill.serviceCents)}</span>
          </div>
          <div className="line total">
            <strong>Total da conta</strong>
            <strong>{money(bill.totalCents)}</strong>
          </div>
          <div className="line">
            <span>Pagamentos líquidos</span>
            <span>{money(bill.paidCents)}</span>
          </div>
          {bill.waivedCents > 0 && (
            <div className="line">
              <span>Baixa excepcional</span>
              <span>{money(bill.waivedCents)}</span>
            </div>
          )}
          <div className="balance">
            <span>Saldo a receber</span>
            <strong>{money(bill.balanceCents)}</strong>
          </div>
        </div>
        <h3>Pagamentos</h3>
        {bill.payments.map((payment) => (
          <div className="payment-row" key={payment.id}>
            <div>
              <strong>
                {paymentLabel[payment.method]} · {money(payment.amountCents)}
              </strong>
              <p className="small muted">
                {dateTime(payment.createdAt)} · {payment.userName}
              </p>
              {payment.method === "cash" && (
                <p className="small">
                  Recebido {money(payment.tenderedCents)} · Troco{" "}
                  {money(payment.changeCents)}
                </p>
              )}
              {payment.refundedCents > 0 && (
                <p className="small error-text">
                  Estorno manual: {money(payment.refundedCents)}
                </p>
              )}
            </div>
            {admin &&
              bill.status !== "closed" &&
              payment.refundedCents < payment.amountCents && (
                <button
                  className="button ghost no-print"
                  onClick={() => setRefund(payment)}
                >
                  Estorno manual
                </button>
              )}
          </div>
        ))}
        {!bill.payments.length && (
          <p className="muted small">Nenhum pagamento registrado.</p>
        )}
        <p className="print-only">
          Documento para conferência. Não substitui documento fiscal.
        </p>
      </div>
      <div className="no-print action-stack section-gap">
        <button className="button" onClick={() => window.print()}>
          <Printer size={17} /> Imprimir conferência não fiscal
        </button>
        {bill.status !== "closed" && (
          <>
            <div className="button-row">
              <button
                className="button primary"
                disabled={bill.balanceCents <= 0}
                onClick={() => setAction("payment")}
              >
                <Wallet size={17} /> Receber pagamento
              </button>
              <button
                className="button"
                disabled={bill.balanceCents !== 0}
                onClick={() => setAction("close")}
              >
                Encerrar conta
              </button>
            </div>
            {admin && (
              <div className="button-row">
                <button className="button ghost" onClick={() => setAction("adjust")}>
                  Desconto e serviço
                </button>
                <button
                  className="button ghost error-text"
                  onClick={() => setAction("exceptional")}
                >
                  Encerramento excepcional
                </button>
              </div>
            )}
          </>
        )}
        {action === "payment" && <PaymentForm bill={bill} done={() => setAction("")} />}
        {action === "adjust" && (
          <Form
            label="Confirmar ajustes"
            onSubmit={async (form) => {
              await mutate(
                `/sessions/${id}/adjustments`,
                {
                  discountCents: parseCents(str(form, "discount")),
                  serviceCents: parseCents(str(form, "service")),
                  reason: str(form, "reason"),
                },
                "PATCH",
              );
              notify("Ajustes registrados.");
              setAction("");
            }}
          >
            <Field label="Desconto (R$)">
              <input
                name="discount"
                inputMode="decimal"
                defaultValue={amountInput(bill.discountCents)}
                required
              />
            </Field>
            <Field label="Serviço (R$)">
              <input
                name="service"
                inputMode="decimal"
                defaultValue={amountInput(bill.serviceCents)}
                required
              />
            </Field>
            <Field label="Justificativa">
              <textarea name="reason" minLength={3} required />
            </Field>
          </Form>
        )}
        {(action === "close" || action === "exceptional") && (
          <Form
            label={
              action === "exceptional"
                ? "Confirmar baixa e encerrar"
                : "Confirmar encerramento"
            }
            danger={action === "exceptional"}
            onSubmit={async (form) => {
              await mutate(
                `/sessions/${id}/close`,
                {
                  exceptional: action === "exceptional",
                  ...(action === "exceptional" ? { reason: str(form, "reason") } : {}),
                },
                "POST",
                `close:${id}`,
              );
              notify("Atendimento encerrado.");
              setAction("");
            }}
          >
            <p>
              {action === "exceptional"
                ? `Confirme a baixa excepcional do saldo de ${money(bill.balanceCents)}. Esta ação ficará registrada na auditoria.`
                : "Confirma o encerramento definitivo desta conta? Novos pedidos exigirão outro atendimento."}
            </p>
            {action === "exceptional" && (
              <Field label="Justificativa obrigatória">
                <textarea name="reason" required minLength={3} />
              </Field>
            )}
          </Form>
        )}
        {refund && (
          <Form
            label="Confirmar estorno manual"
            danger
            onSubmit={async (form) => {
              await mutate(
                `/payments/${refund.id}/refund`,
                {
                  amountCents: parseCents(str(form, "amount")),
                  reason: str(form, "reason"),
                },
                "POST",
                `refund:${refund.id}`,
              );
              notify("Estorno manual registrado.");
              setRefund(null);
            }}
          >
            <div className="alert">
              Este registro não faz devolução bancária. Confirme o valor devolvido por
              outro meio.
            </div>
            <Field label="Valor do estorno (R$)">
              <input
                name="amount"
                inputMode="decimal"
                defaultValue={amountInput(refund.amountCents - refund.refundedCents)}
                required
              />
            </Field>
            <Field label="Justificativa">
              <textarea name="reason" required minLength={3} />
            </Field>
            <button
              type="button"
              className="button ghost"
              onClick={() => setRefund(null)}
            >
              Voltar
            </button>
          </Form>
        )}
        {action && (
          <button className="button ghost" onClick={() => setAction("")}>
            Voltar à conta
          </button>
        )}
      </div>
    </Modal>
  );
}
function PaymentForm({ bill, done }: { bill: Bill; done: () => void }) {
  const { data, mutate, notify } = useStore();
  const [method, setMethod] = useState("pix");
  const [review, setReview] = useState<{
    amountCents: number;
    tenderedCents?: number;
  } | null>(null);
  return review ? (
    <div className="confirm-box">
      <Form
        label="Confirmar recebimento"
        onSubmit={async () => {
          await mutate(
            `/sessions/${bill.id}/payments`,
            { ...review, method },
            "POST",
            `payment:${bill.id}`,
          );
          notify("Pagamento registrado.");
          done();
        }}
      >
        <strong>
          {paymentLabel[method]} · {money(review.amountCents)}
        </strong>
        {review.tenderedCents !== undefined && (
          <p>
            Recebido: {money(review.tenderedCents)} · Troco:{" "}
            {money(review.tenderedCents - review.amountCents)}
          </p>
        )}
        <p className="small muted">Confirme somente após receber o valor.</p>
        <button type="button" className="button ghost" onClick={() => setReview(null)}>
          Corrigir valores
        </button>
      </Form>
    </div>
  ) : (
    <Form
      label="Revisar pagamento"
      onSubmit={async (form) => {
        const amountCents = parseCents(str(form, "amount"));
        if (amountCents <= 0 || amountCents > bill.balanceCents)
          throw new Error("Informe um valor positivo até o saldo da conta.");
        const tenderedCents =
          method === "cash" ? parseCents(str(form, "tendered")) : undefined;
        if (tenderedCents !== undefined && tenderedCents < amountCents)
          throw new Error("O valor recebido deve cobrir o pagamento.");
        setReview({
          amountCents,
          ...(tenderedCents === undefined ? {} : { tenderedCents }),
        });
      }}
    >
      <Field label="Forma de pagamento">
        <select value={method} onChange={(event) => setMethod(event.target.value)}>
          {Object.entries(paymentLabel)
            .filter(([key]) => key !== "other" || data.settings.otherPaymentEnabled)
            .map(([key, label]) => (
              <option value={key} key={key}>
                {label}
              </option>
            ))}
        </select>
      </Field>
      <Field label="Valor a pagar (R$) · pode ser parcial">
        <input
          name="amount"
          inputMode="decimal"
          defaultValue={amountInput(bill.balanceCents)}
          required
        />
      </Field>
      {method === "cash" && (
        <Field label="Valor recebido em dinheiro (R$)">
          <input name="tendered" inputMode="decimal" required />
        </Field>
      )}
    </Form>
  );
}
export function HistoryPage() {
  const { data } = useStore();
  const [id, setId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  return (
    <>
      <Heading
        eyebrow="REGISTRO DO SALÃO"
        title="Histórico de atendimentos"
        description="Contas, pagamentos e consumo preservados em cada atendimento."
      />
      <input
        className="search-field"
        aria-label="Buscar mesa no histórico"
        placeholder="Buscar por número da mesa…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th>Mesa / abertura</th>
              <th>Situação</th>
              <th>Total</th>
              <th>Pago</th>
              <th>Saldo</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.sessions
              .filter((bill) => String(bill.tableId).includes(search))
              .map((bill) => (
                <tr key={bill.id}>
                  <td>
                    <strong>Mesa {String(bill.tableId).padStart(2, "0")}</strong>
                    <small>{dateTime(bill.openedAt)}</small>
                  </td>
                  <td>
                    <Badge status={bill.status} />
                  </td>
                  <td>{money(bill.totalCents)}</td>
                  <td>{money(bill.paidCents)}</td>
                  <td>{money(bill.balanceCents)}</td>
                  <td>
                    <button className="button ghost" onClick={() => setId(bill.id)}>
                      Ver conta
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {!data.sessions.length && <Empty>Nenhum atendimento registrado.</Empty>}
      </div>
      {id && <BillDialog id={id} onClose={() => setId(null)} />}
    </>
  );
}
