import { useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { Heading, Field, Form, Modal, Empty, str } from "../components";
import { money, parseCents, dateTime } from "../api";
import { useStore } from "../state";
import { useOperationData, type Ingredient } from "./InventoryPage";
import { SIMULATION } from "../environment";
interface ResourceState {
  openingBalanceCents: number | null;
  sponsors: { id: string; name: string; active: boolean }[];
  contributions: {
    id: string;
    sponsorId: string;
    cashCents: number;
    status: string;
    notes: string;
    occurredAt: string;
  }[];
  equipment: { id: string; name: string; quantity: number; active: boolean }[];
  ledger: {
    id: string;
    kind: string;
    amountCents: number;
    reason: string;
    occurredAt: string;
  }[];
}
interface GoodsLine {
  kind: "ingredient" | "equipment";
  ingredientId?: string;
  name: string;
  quantity: number;
  valuationCents: number | null;
}
export function TrainingResourcesPage() {
  const { auth, mutate, notify } = useStore();
  const admin = auth?.user.role === "admin";
  const { value, refresh, error } = useOperationData<ResourceState>("/resources", {
    openingBalanceCents: null,
    sponsors: [],
    contributions: [],
    equipment: [],
    ledger: [],
  });
  const { value: ingredients } = useOperationData<Ingredient[]>("/inventory", []);
  const { value: purchases } = useOperationData<{
    items: { id: string; supplierName: string; totalCents: number; status: string }[];
  }>("/purchases", { items: [] });
  const { value: sync } = useOperationData<{
    enabled: boolean;
    pending?: number;
    lastError?: string | null;
  }>("/dashboard-sync", { enabled: false });
  const [modal, setModal] = useState<
      "sponsor" | "contribution" | "entry" | "opening" | "reverse" | null
    >(null),
    [target, setTarget] = useState<{ id: string; kind: "contribution" | "entry" } | null>(
      null,
    ),
    [key, setKey] = useState(() => crypto.randomUUID()),
    [lines, setLines] = useState<GoodsLine[]>([]),
    [cashKind, setCashKind] = useState("expense"),
    [goodsKind, setGoodsKind] = useState<"ingredient" | "equipment">("ingredient"),
    [ingredientId, setIngredientId] = useState(""),
    [goodsName, setGoodsName] = useState(""),
    [goodsQuantity, setGoodsQuantity] = useState("1"),
    [valuation, setValuation] = useState(""),
    [lineError, setLineError] = useState("");
  if (!SIMULATION)
    return <Empty>Recursos disponíveis somente no ambiente de treinamento.</Empty>;
  const open = (next: typeof modal) => {
    setKey(crypto.randomUUID());
    setLines([]);
    setLineError("");
    setModal(next);
  };
  async function save(path: string, body: Record<string, unknown>) {
    await mutate(path, { requestId: key, ...body }, "POST", "resource:" + key);
    await refresh();
    setModal(null);
    notify("Operação simulada registrada.");
  }
  function addLine() {
    try {
      const quantity = Number(goodsQuantity);
      if (!Number.isSafeInteger(quantity) || quantity < 1)
        throw new Error("Informe quantidade inteira na unidade base.");
      const ingredient = ingredients.find((i) => i.id === ingredientId);
      if (goodsKind === "ingredient" && !ingredient)
        throw new Error("Selecione um ingrediente.");
      if (goodsKind === "equipment" && !goodsName.trim())
        throw new Error("Informe o nome do equipamento.");
      setLines((old) => [
        ...old,
        {
          kind: goodsKind,
          ...(goodsKind === "ingredient" ? { ingredientId } : {}),
          name: goodsKind === "ingredient" ? ingredient!.name : goodsName.trim(),
          quantity,
          valuationCents: valuation.trim() ? parseCents(valuation) : null,
        },
      ]);
      setLineError("");
      setGoodsName("");
      setGoodsQuantity("1");
      setValuation("");
    } catch (e) {
      setLineError(e instanceof Error ? e.message : "Confira os bens recebidos.");
    }
  }
  const balance =
    value.openingBalanceCents === null
      ? null
      : value.openingBalanceCents +
        value.ledger.reduce((sum, e) => sum + e.amountCents, 0);
  return (
    <>
      <Heading
        eyebrow="TREINAMENTO · RECURSOS FICTÍCIOS"
        title="Patrocínios e caixa"
        description="Receba dinheiro, alimentos e equipamentos. Registre despesas e pagamentos sem misturar estoque e caixa."
      >
        <button className="button" onClick={() => void refresh()}>
          <RefreshCw size={15} />
          Atualizar
        </button>
        {admin && (
          <>
            <button className="button" onClick={() => open("sponsor")}>
              Cadastrar patrocinador
            </button>
            <button className="button primary" onClick={() => open("contribution")}>
              <Plus size={16} />
              Receber contribuição
            </button>
          </>
        )}
      </Heading>
      {error && (
        <div role="alert" className="alert error">
          {error}
        </div>
      )}
      <div className="stats-grid">
        <div className="stat">
          <span>Saldo de caixa simulado</span>
          <strong>{balance === null ? "Abertura não informada" : money(balance)}</strong>
        </div>
        <div className="stat">
          <span>Patrocinadores</span>
          <strong>{value.sponsors.length}</strong>
        </div>
        <div className="stat">
          <span>Integração do dashboard</span>
          <strong>
            {sync.enabled
              ? `${sync.pending ?? 0} envio(s) pendente(s)`
              : "Não configurada"}
          </strong>
          {sync.lastError && <small>Falha no envio. Consulte a configuração.</small>}
        </div>
      </div>
      {admin && (
        <div className="heading-actions" style={{ margin: "20px 0" }}>
          {value.openingBalanceCents === null && (
            <button className="button" onClick={() => open("opening")}>
              Registrar abertura da rodada
            </button>
          )}
          <button className="button" onClick={() => open("entry")}>
            Registrar entrada / despesa / pagamento
          </button>
        </div>
      )}
      <section className="panel">
        <h2>Contribuições recebidas</h2>
        {value.contributions.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Patrocinador</th>
                  <th>Dinheiro</th>
                  <th>Estado</th>
                  <th>Data</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {value.contributions.map((c) => (
                  <tr key={c.id}>
                    <td>{value.sponsors.find((s) => s.id === c.sponsorId)?.name}</td>
                    <td>{money(c.cashCents)}</td>
                    <td>{c.status === "received" ? "Recebido" : "Revertido"}</td>
                    <td>{dateTime(c.occurredAt)}</td>
                    <td>
                      {admin && c.status === "received" && (
                        <button
                          className="button"
                          onClick={() => {
                            setTarget({ id: c.id, kind: "contribution" });
                            open("reverse");
                          }}
                        >
                          Reverter contribuição
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Cadastre um patrocinador e registre o apoio recebido.</Empty>
        )}
      </section>
      <section className="panel">
        <h2>Livro de caixa</h2>
        <p className="muted">
          Pagamentos e estornos de clientes vêm das operações originais. Mercadoria
          recebida não implica pagamento.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Descrição</th>
                <th>Data</th>
                <th>Valor</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {value.ledger.slice(0, 100).map((e) => (
                <tr key={e.id}>
                  <td>{e.reason}</td>
                  <td>{dateTime(e.occurredAt)}</td>
                  <td>{money(e.amountCents)}</td>
                  <td>
                    {admin &&
                      ["expense", "other_inflow", "purchase_payment"].includes(
                        e.kind,
                      ) && (
                        <button
                          className="button"
                          onClick={() => {
                            setTarget({ id: e.id, kind: "entry" });
                            open("reverse");
                          }}
                        >
                          Reverter lançamento
                        </button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {modal && (
        <Modal
          title={
            {
              sponsor: "Cadastrar patrocinador",
              contribution: "Receber contribuição simulada",
              entry: "Registrar movimentação de caixa",
              opening: "Registrar abertura da rodada",
              reverse: "Reverter com justificativa",
            }[modal]
          }
          onClose={() => setModal(null)}
        >
          {modal === "sponsor" ? (
            <Form
              onSubmit={async (form) => {
                await mutate("/resources/sponsors", { name: str(form, "name") });
                await refresh();
                setModal(null);
              }}
            >
              <Field label="Nome do patrocinador">
                <input name="name" minLength={2} maxLength={120} required />
              </Field>
            </Form>
          ) : modal === "contribution" ? (
            <Form
              onSubmit={(form) =>
                save("/resources/contributions", {
                  sponsorId: str(form, "sponsor"),
                  cashCents: parseCents(str(form, "cash") || "0"),
                  notes: str(form, "notes"),
                  lines,
                })
              }
              label="Confirmar recebimento"
            >
              <Field label="Patrocinador">
                <select name="sponsor" required>
                  <option value="">Selecione</option>
                  {value.sponsors.map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Dinheiro recebido (R$)">
                <input name="cash" inputMode="decimal" defaultValue="0,00" />
              </Field>
              <Field label="Observações">
                <textarea name="notes" maxLength={1000} />
              </Field>
              <fieldset>
                <legend>Alimentos e equipamentos recebidos</legend>
                <Field label="Tipo do bem">
                  <select
                    value={goodsKind}
                    onChange={(e) => setGoodsKind(e.target.value as typeof goodsKind)}
                  >
                    <option value="ingredient">Alimento</option>
                    <option value="equipment">Equipamento</option>
                  </select>
                </Field>
                {goodsKind === "ingredient" ? (
                  <Field label="Ingrediente">
                    <select
                      value={ingredientId}
                      onChange={(e) => setIngredientId(e.target.value)}
                    >
                      <option value="">Selecione</option>
                      {ingredients.map((i) => (
                        <option value={i.id} key={i.id}>
                          {i.name} ({i.unit})
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : (
                  <Field label="Nome do equipamento">
                    <input
                      value={goodsName}
                      onChange={(e) => setGoodsName(e.target.value)}
                      maxLength={120}
                    />
                  </Field>
                )}
                <Field label="Quantidade inteira (g, ml ou un do ingrediente)">
                  <input
                    value={goodsQuantity}
                    onChange={(e) => setGoodsQuantity(e.target.value)}
                    inputMode="numeric"
                  />
                </Field>
                <Field label="Avaliação total do bem em R$ (opcional)">
                  <input
                    value={valuation}
                    onChange={(e) => setValuation(e.target.value)}
                    inputMode="decimal"
                  />
                </Field>
                <button className="button" type="button" onClick={addLine}>
                  Adicionar bem à contribuição
                </button>
                {lineError && <p role="alert">{lineError}</p>}
                {lines.map((l, i) => (
                  <div key={i} className="heading-actions">
                    <span>
                      {l.name}: {l.quantity} ·{" "}
                      {l.valuationCents === null
                        ? "Sem avaliação"
                        : money(l.valuationCents)}
                    </span>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remover bem ${i + 1}`}
                      onClick={() => setLines((old) => old.filter((_, n) => n !== i))}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </fieldset>
            </Form>
          ) : modal === "entry" ? (
            <Form
              onSubmit={(form) =>
                save("/resources/entries", {
                  kind: str(form, "kind"),
                  amountCents: parseCents(str(form, "amount")),
                  reason: str(form, "reason"),
                  ...(str(form, "purchaseId")
                    ? { purchaseId: str(form, "purchaseId") }
                    : {}),
                })
              }
            >
              <Field label="Tipo de movimentação">
                <select
                  name="kind"
                  value={cashKind}
                  onChange={(e) => setCashKind(e.target.value)}
                >
                  <option value="expense">Despesa</option>
                  <option value="other_inflow">Outra entrada</option>
                  <option value="purchase_payment">Pagamento de compra</option>
                </select>
              </Field>
              <Field label="Compra (somente para pagamento)">
                <select
                  name="purchaseId"
                  disabled={cashKind !== "purchase_payment"}
                  required={cashKind === "purchase_payment"}
                >
                  <option value="">Selecione a compra</option>
                  {purchases.items
                    .filter((p) => p.status !== "draft")
                    .map((p) => (
                      <option value={p.id} key={p.id}>
                        {p.supplierName} · {money(p.totalCents)} · {p.id.slice(0, 6)}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Valor em reais">
                <input name="amount" inputMode="decimal" required />
              </Field>
              <Field label="Justificativa">
                <textarea name="reason" minLength={3} required />
              </Field>
            </Form>
          ) : modal === "opening" ? (
            <Form
              onSubmit={(form) =>
                save("/resources/opening", {
                  amountCents: parseCents(str(form, "amount")),
                  reason: str(form, "reason"),
                })
              }
            >
              <p className="muted">
                Informe a abertura no início da rodada, antes de todos os movimentos. Não
                informe o caixa atual de uma rodada que já contém histórico.
              </p>
              <Field label="Saldo inicial em reais">
                <input name="amount" inputMode="decimal" required />
              </Field>
              <Field label="Justificativa da abertura">
                <textarea name="reason" minLength={3} required />
              </Field>
            </Form>
          ) : (
            <Form
              danger
              label="Confirmar reversão"
              onSubmit={(form) =>
                save(
                  target!.kind === "contribution"
                    ? `/resources/contributions/${target!.id}/reverse`
                    : `/resources/entries/${target!.id}/reverse`,
                  { reason: str(form, "reason") },
                )
              }
            >
              <p className="muted">
                A reversão preserva o histórico. Alimentos já consumidos ou reservados
                exigem ajuste operacional, sem devolver estoque ficticiamente.
              </p>
              <Field label="Motivo da reversão">
                <textarea name="reason" minLength={3} required />
              </Field>
            </Form>
          )}
        </Modal>
      )}
    </>
  );
}
