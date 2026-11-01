import { useState } from "react";
import { BarChart3, PackageSearch, RefreshCw, ShoppingCart } from "lucide-react";
import { money, parseCents } from "../api";
import { Empty, Field, Form, Heading, Modal, str } from "../components";
import { useStore } from "../state";
import {
  displayQuantity,
  useOperationData,
  type Ingredient,
  type Supplier,
} from "./InventoryPage";

interface Suggestion {
  ingredientId: string;
  name: string;
  unit: string;
  available: number;
  minimum: number;
  incoming: number;
  averageDaily: number;
  observedDays: number;
  suggested: number;
  limitedHistory: boolean;
  preferredSupplierId: string | null;
}
interface Analytics {
  from: string;
  to: string;
  timeZone: string;
  ranking: {
    productId: number;
    name: string;
    ordered: number;
    cancelled: number;
    valid: number;
    valueCents: number;
  }[];
  paymentsCents: number;
  refundedCents: number;
  stock: Ingredient[];
  consumption: {
    ingredientId: string;
    name: string;
    unit: string;
    consumed: number;
    wasted: number;
  }[];
  purchases: { confirmedCents: number; receivedCents: number; pendingCount: number };
  replenishment: Suggestion[];
  coverage: { trackedProducts: number; totalProducts: number };
}
const empty: Analytics = {
  from: "",
  to: "",
  timeZone: "America/Fortaleza",
  ranking: [],
  paymentsCents: 0,
  refundedCents: 0,
  stock: [],
  consumption: [],
  purchases: { confirmedCents: 0, receivedCents: 0, pendingCount: 0 },
  replenishment: [],
  coverage: { trackedProducts: 0, totalProducts: 0 },
};
export function AnalyticsPage() {
  const { auth, data, mutate, notify } = useStore();
  const [filters, setFilters] = useState({
    from: "",
    to: "",
    category: "",
    productId: "",
    ingredientId: "",
    supplierId: "",
    days: "7",
  });
  const query = new URLSearchParams(
    Object.entries(filters).filter(([, value]) => value !== ""),
  ).toString();
  const { value, error, loading, refresh } = useOperationData<Analytics>(
    `/analytics?${query}`,
    empty,
  );
  const { value: ingredients } = useOperationData<Ingredient[]>("/inventory", []);
  const { value: suppliers } = useOperationData<Supplier[]>("/suppliers", []);
  const [tab, setTab] = useState("sales");
  const [draft, setDraft] = useState(false);
  const [supplier, setSupplier] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const recommendations = value.replenishment.filter((i) => i.suggested > 0);
  const filteredRecommendations = recommendations.filter(
    (i) =>
      !supplier ||
      i.preferredSupplierId === supplier ||
      suppliers.find((s) => s.id === supplier)?.ingredientIds.includes(i.ingredientId),
  );
  const maxOrdered = Math.max(1, ...value.ranking.map((i) => i.valid));
  function filter(key: keyof typeof filters, val: string) {
    setFilters((old) => ({ ...old, [key]: val }));
  }
  return (
    <>
      <Heading
        eyebrow="INTELIGÊNCIA OPERACIONAL"
        title="Indicadores e reposição"
        description="Vendas, consumo e compras baseados nos registros do restaurante."
      >
        <button className="button subtle" onClick={() => void refresh()}>
          <RefreshCw size={16} /> Atualizar
        </button>
        {auth?.user.role === "admin" && (
          <button
            className="button primary"
            disabled={!recommendations.length || !suppliers.some((s) => s.active)}
            onClick={() => {
              setDraft(true);
              setSupplier(suppliers.find((s) => s.active)?.id || "");
              setSelected([]);
            }}
          >
            <ShoppingCart size={16} /> Planejar reposição
          </button>
        )}
      </Heading>
      <section className="panel ops-section">
        <div className="ops-filter-grid">
          <Field label="Data inicial">
            <input
              type="date"
              value={filters.from || value.from}
              max={filters.to}
              onChange={(e) => filter("from", e.target.value)}
            />
          </Field>
          <Field label="Data final">
            <input
              type="date"
              value={filters.to || value.to}
              min={filters.from}
              onChange={(e) => filter("to", e.target.value)}
            />
          </Field>
          <Field label="Categoria">
            <select
              value={filters.category}
              onChange={(e) => filter("category", e.target.value)}
            >
              <option value="">Todas</option>
              {data.categories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Produto">
            <select
              value={filters.productId}
              onChange={(e) => filter("productId", e.target.value)}
            >
              <option value="">Todos</option>
              {data.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Ingrediente">
            <select
              value={filters.ingredientId}
              onChange={(e) => filter("ingredientId", e.target.value)}
            >
              <option value="">Todos</option>
              {ingredients.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Fornecedor">
            <select
              value={filters.supplierId}
              onChange={(e) => filter("supplierId", e.target.value)}
            >
              <option value="">Todos</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <small className="muted">
          Período em {value.timeZone}. Pedidos pela criação; consumo pela movimentação;
          compras pela confirmação ou recebimento; pagamentos pelo registro.
        </small>
      </section>
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
      <div className="stats-grid">
        <article className="stat-card">
          <span>Valor de itens válidos</span>
          <strong>
            {money(value.ranking.reduce((sum, i) => sum + i.valueCents, 0))}
          </strong>
          <small>Preços históricos, exclui itens cancelados</small>
        </article>
        <article className="stat-card">
          <span>Recebimentos de clientes</span>
          <strong>{money(value.paymentsCents)}</strong>
          <small>Estornos no período: {money(value.refundedCents)}</small>
        </article>
        <article className="stat-card">
          <span>Compras recebidas</span>
          <strong>{money(value.purchases.receivedCents)}</strong>
          <small>{value.purchases.pendingCount} compras aguardando recebimento</small>
        </article>
        <article className="stat-card">
          <span>Cobertura de fichas técnicas</span>
          <strong>
            {value.coverage.trackedProducts}/{value.coverage.totalProducts}
          </strong>
          <small>Produtos com controle de ingredientes ativo</small>
        </article>
      </div>
      <nav className="ops-tabs" aria-label="Indicadores">
        <button
          className={`button ${tab === "sales" ? "primary" : "subtle"}`}
          aria-pressed={tab === "sales"}
          onClick={() => setTab("sales")}
        >
          <BarChart3 size={16} /> Mais pedidos
        </button>
        <button
          className={`button ${tab === "consumption" ? "primary" : "subtle"}`}
          aria-pressed={tab === "consumption"}
          onClick={() => setTab("consumption")}
        >
          Consumo e estoque
        </button>
        <button
          className={`button ${tab === "replenishment" ? "primary" : "subtle"}`}
          aria-pressed={tab === "replenishment"}
          onClick={() => setTab("replenishment")}
        >
          <PackageSearch size={16} /> Reposição
        </button>
      </nav>
      {tab === "sales" && (
        <section className="panel ops-section">
          <div>
            <h2>Produtos mais pedidos</h2>
            <p className="muted">
              Ordenação por unidades válidas. Valores de pedidos não representam
              recebimentos financeiros.
            </p>
          </div>
          {!value.ranking.length ? (
            <Empty>
              {loading
                ? "Calculando indicadores…"
                : "Nenhum pedido no período selecionado."}
            </Empty>
          ) : (
            <>
              <div className="ops-ranking" aria-hidden="true">
                {value.ranking.slice(0, 8).map((i) => (
                  <div key={i.productId}>
                    <span>{i.name}</span>
                    <div>
                      <span
                        style={{ width: `${Math.max(1, (i.valid / maxOrdered) * 100)}%` }}
                      />
                    </div>
                    <strong>{i.valid}</strong>
                  </div>
                ))}
              </div>
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <caption className="sr-only">
                    Quantidades e valores dos produtos pedidos
                  </caption>
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>Pedidos</th>
                      <th>Cancelados</th>
                      <th>Válidos</th>
                      <th>Valor válido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {value.ranking.map((i) => (
                      <tr key={i.productId}>
                        <td>{i.name}</td>
                        <td>{i.ordered}</td>
                        <td>{i.cancelled}</td>
                        <td>{i.valid}</td>
                        <td>{money(i.valueCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
      {tab === "consumption" && (
        <>
          <section className="panel ops-section">
            <h2>Consumo e desperdício no período</h2>
            <p className="muted">
              O desperdício identifica parte de ingredientes já consumidos; não é uma
              segunda saída de estoque.
            </p>
            {!value.consumption.length ? (
              <Empty>
                Nenhum consumo registrado no período. Produtos sem ficha não geram consumo
                calculado.
              </Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Ingrediente</th>
                      <th>Consumido</th>
                      <th>Desperdiçado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {value.consumption.map((i) => (
                      <tr key={i.ingredientId}>
                        <td>{i.name}</td>
                        <td>{displayQuantity(i.consumed, i.unit)}</td>
                        <td>{displayQuantity(i.wasted, i.unit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="panel ops-section">
            <h2>Posição atual do estoque</h2>
            <p className="muted">
              Saldos atuais; não são uma reconstrução do estoque na data final do filtro.
            </p>
            {!value.stock.length ? (
              <Empty>Nenhum ingrediente cadastrado.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Ingrediente</th>
                      <th>Físico</th>
                      <th>Reservado</th>
                      <th>Disponível</th>
                      <th>Mínimo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {value.stock.map((i) => (
                      <tr key={i.id}>
                        <td>{i.name}</td>
                        <td>{displayQuantity(i.physical, i.unit)}</td>
                        <td>{displayQuantity(i.reserved, i.unit)}</td>
                        <td className={i.available < i.minimum ? "ops-warning" : ""}>
                          {displayQuantity(i.available, i.unit)}
                        </td>
                        <td>{displayQuantity(i.minimum, i.unit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
      {tab === "replenishment" && (
        <section className="panel ops-section">
          <div className="section-heading">
            <div>
              <h2>Sugestões de compra</h2>
              <p className="muted">
                Estimativa operacional pelos últimos 28 dias de consumo e saldos atuais.
              </p>
            </div>
            <Field label="Dias de cobertura">
              <input
                type="number"
                min="1"
                max="90"
                value={filters.days}
                onChange={(e) => filter("days", e.target.value)}
              />
            </Field>
          </div>
          <p className="ops-formula">
            Reposição = consumo médio diário × cobertura + mínimo − disponível − compras a
            receber. O resultado é arredondado para cima e nunca abaixo de zero.
          </p>
          {!value.replenishment.length ? (
            <Empty>
              Cadastre ingredientes e inicie seu acompanhamento para calcular reposição.
            </Empty>
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Ingrediente</th>
                    <th>Disponível</th>
                    <th>A receber</th>
                    <th>Média diária</th>
                    <th>Histórico observado</th>
                    <th>Compra sugerida</th>
                  </tr>
                </thead>
                <tbody>
                  {value.replenishment.map((i) => (
                    <tr key={i.ingredientId}>
                      <td>
                        <strong>{i.name}</strong>
                        <small>
                          {suppliers.find((s) => s.id === i.preferredSupplierId)?.name ||
                            "Fornecedor a definir"}
                        </small>
                      </td>
                      <td>{displayQuantity(i.available, i.unit)}</td>
                      <td>{displayQuantity(i.incoming, i.unit)}</td>
                      <td>
                        {i.averageDaily.toLocaleString("pt-BR", {
                          maximumFractionDigits: 2,
                        })}{" "}
                        {i.unit}
                      </td>
                      <td>
                        {i.observedDays} dias
                        <small>
                          {i.limitedHistory
                            ? "Histórico limitado: usa necessidade do mínimo"
                            : "Inclui dias sem consumo"}
                        </small>
                      </td>
                      <td>
                        <strong>{displayQuantity(i.suggested, i.unit)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="ops-form-grid">
            <article className="ops-card">
              <span>Compras confirmadas no período</span>
              <strong>{money(value.purchases.confirmedCents)}</strong>
            </article>
            <article className="ops-card">
              <span>Entradas recebidas no período</span>
              <strong>{money(value.purchases.receivedCents)}</strong>
            </article>
          </div>
          <small className="muted">
            Esses valores representam aquisições, sem controle de pagamento ao fornecedor
            nesta versão.
          </small>
        </section>
      )}
      {draft && (
        <Modal title="Transformar sugestões em rascunho" onClose={() => setDraft(false)}>
          <Form
            label="Criar rascunho de compra"
            onSubmit={async (form) => {
              const items = filteredRecommendations
                .filter((i) => selected.includes(i.ingredientId))
                .map((i) => ({
                  ingredientId: i.ingredientId,
                  quantity: Number(str(form, `quantity-${i.ingredientId}`)),
                  totalCents: parseCents(str(form, `price-${i.ingredientId}`)),
                }));
              if (!items.length) throw new Error("Selecione ao menos um ingrediente.");
              await mutate(
                "/purchases",
                {
                  supplierId: supplier,
                  notes:
                    "Rascunho criado a partir da estimativa de reposição. Valores informados pelo administrador.",
                  items,
                },
                "POST",
                "replenishment-purchase",
              );
              notify("Rascunho criado. Revise e confirme em Compras.");
              setDraft(false);
            }}
          >
            <Field label="Fornecedor da reposição">
              <select
                required
                value={supplier}
                onChange={(e) => {
                  setSupplier(e.target.value);
                  setSelected([]);
                }}
              >
                <option value="">Selecione</option>
                {suppliers
                  .filter((s) => s.active)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </Field>
            <p className="muted">
              Selecione ingredientes associados ao fornecedor e informe os valores
              estimados. Nenhuma compra será enviada automaticamente.
            </p>
            {!filteredRecommendations.length && (
              <Empty>
                Este fornecedor não possui ingredientes com reposição sugerida. Associe os
                ingredientes no cadastro.
              </Empty>
            )}
            {filteredRecommendations.map((i) => (
              <div className="ops-card" key={i.ingredientId}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={selected.includes(i.ingredientId)}
                    onChange={(e) =>
                      setSelected((old) =>
                        e.target.checked
                          ? [...old, i.ingredientId]
                          : old.filter((id) => id !== i.ingredientId),
                      )
                    }
                  />
                  {i.name}
                </label>
                {selected.includes(i.ingredientId) && (
                  <div className="ops-form-grid">
                    <Field label={`Quantidade ${i.name} (${i.unit})`}>
                      <input
                        required
                        name={`quantity-${i.ingredientId}`}
                        type="number"
                        min="1"
                        step="1"
                        defaultValue={i.suggested}
                      />
                    </Field>
                    <Field label={`Valor total estimado ${i.name} (R$)`}>
                      <input
                        required
                        name={`price-${i.ingredientId}`}
                        inputMode="decimal"
                      />
                    </Field>
                  </div>
                )}
              </div>
            ))}
          </Form>
        </Modal>
      )}
    </>
  );
}
