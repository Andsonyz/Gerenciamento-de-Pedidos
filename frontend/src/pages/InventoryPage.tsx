import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardList, PackagePlus, Plus, RefreshCw, Scale } from "lucide-react";
import { api, dateTime } from "../api";
import { Empty, Field, Form, Heading, Modal, str } from "../components";
import { useStore } from "../state";

export interface Ingredient {
  id: string;
  name: string;
  unit: "g" | "ml" | "un";
  minimum: number;
  active: boolean;
  preferredSupplierId: string | null;
  trackingSince: string;
  physical: number;
  reserved: number;
  available: number;
}
export interface Supplier {
  id: string;
  name: string;
  phone: string;
  email: string;
  active: boolean;
  ingredientIds: string[];
  createdAt: string;
}
interface Recipe {
  id: string;
  productId: number;
  version: number;
  active: boolean;
  createdAt: string;
  items: { ingredientId: string; name: string; unit: string; quantity: number }[];
}
interface Movement {
  id: string;
  ingredientId: string;
  ingredientName?: string;
  name?: string;
  kind: string;
  quantity: number;
  unit: string;
  reservedDelta: number;
  wasteQuantity: number;
  reason: string;
  createdAt: string;
  userName?: string;
}

export function useOperationData<T>(path: string, initial: T, interval = 5000) {
  const { auth, data, realtimePaused } = useStore();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const version = useRef(0);
  const invalidate = useCallback(() => {
    ++version.current;
  }, []);
  const refresh = useCallback(async () => {
    if (!auth) return;
    const request = ++version.current;
    try {
      const next = await api<T>(path);
      if (request !== version.current) return;
      setValue(next);
      setError("");
    } catch (cause) {
      if (request !== version.current) return;
      setError(
        cause instanceof Error ? cause.message : "Falha ao consultar os registros.",
      );
    } finally {
      if (request === version.current) setLoading(false);
    }
  }, [auth, path]);
  useEffect(() => {
    void refresh();
    return invalidate;
  }, [refresh, data, invalidate]);
  useEffect(() => {
    if (realtimePaused) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, interval);
    return () => window.clearInterval(timer);
  }, [refresh, interval, realtimePaused]);
  return { value, error, loading, refresh };
}

export function quantityInBase(value: string, unit: string): number {
  if (!["g", "kg", "ml", "l", "un"].includes(unit))
    throw new Error("Unidade de quantidade inválida.");
  if (!/^\d+(?:[,.]\d+)?$/.test(value.trim()))
    throw new Error("Informe uma quantidade positiva válida.");
  const [whole, fraction = ""] = value.trim().replace(",", ".").split(".");
  const precision = unit === "kg" || unit === "l" ? 3 : 0;
  if (fraction.length > precision && /[1-9]/.test(fraction.slice(precision)))
    throw new Error(
      "A quantidade deve corresponder a gramas, mililitros ou unidades inteiras.",
    );
  const amount =
    Number(whole) * 10 ** precision +
    Number(fraction.slice(0, precision).padEnd(precision, "0"));
  if (!Number.isSafeInteger(amount))
    throw new Error("Quantidade fora do limite permitido.");
  return amount;
}
export const displayQuantity = (value: number, unit: string) =>
  `${value.toLocaleString("pt-BR")} ${unit}`;

function IngredientEditor({
  ingredient,
  suppliers,
  onClose,
  onSaved,
}: {
  ingredient?: Ingredient;
  suppliers: Supplier[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { mutate, notify } = useStore();
  const [unit, setUnit] = useState(ingredient?.unit || "g");
  return (
    <Modal
      title={ingredient ? "Editar ingrediente" : "Novo ingrediente"}
      onClose={onClose}
    >
      <Form
        onSubmit={async (form) => {
          const inputUnit = str(form, "unit");
          await mutate(
            ingredient ? `/ingredients/${ingredient.id}` : "/ingredients",
            {
              name: str(form, "name"),
              unit: inputUnit === "kg" ? "g" : inputUnit === "l" ? "ml" : inputUnit,
              minimum: quantityInBase(str(form, "minimum"), inputUnit),
              active: form.has("active"),
              preferredSupplierId: str(form, "supplier") || null,
            },
            ingredient ? "PATCH" : "POST",
          );
          await onSaved();
          notify("Ingrediente salvo.");
          onClose();
        }}
      >
        <Field label="Nome do ingrediente">
          <input name="name" required maxLength={120} defaultValue={ingredient?.name} />
        </Field>
        <div className="ops-form-grid">
          <Field label="Unidade">
            <select
              name="unit"
              value={unit}
              disabled={!!ingredient}
              onChange={(e) => setUnit(e.target.value as typeof unit)}
            >
              <option value="g">Gramas (g)</option>
              <option value="kg">Quilogramas (kg)</option>
              <option value="ml">Mililitros (ml)</option>
              <option value="l">Litros (L)</option>
              <option value="un">Unidades</option>
            </select>
          </Field>
          {ingredient && <input type="hidden" name="unit" value={unit} />}
          <Field label="Estoque mínimo">
            <input
              name="minimum"
              inputMode="decimal"
              required
              defaultValue={ingredient?.minimum || 0}
            />
          </Field>
        </div>
        <Field label="Fornecedor preferencial">
          <select name="supplier" defaultValue={ingredient?.preferredSupplierId || ""}>
            <option value="">Não definido</option>
            {suppliers
              .filter((s) => s.active || s.id === ingredient?.preferredSupplierId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </Field>
        <label className="check">
          <input
            name="active"
            type="checkbox"
            defaultChecked={ingredient?.active ?? true}
          />{" "}
          Ingrediente ativo
        </label>
        <p className="muted">
          O saldo inicial é registrado separadamente como uma movimentação auditada.
        </p>
      </Form>
    </Modal>
  );
}

function StockEditor({
  ingredients,
  onClose,
  onSaved,
}: {
  ingredients: Ingredient[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { mutate, notify } = useStore();
  const [selected, setSelected] = useState(ingredients[0]?.id || "");
  const [kind, setKind] = useState("initial");
  const ingredient = ingredients.find((i) => i.id === selected);
  return (
    <Modal title="Movimentar estoque" onClose={onClose}>
      <Form
        onSubmit={async (form) => {
          const quantity = quantityInBase(str(form, "quantity"), str(form, "unit"));
          if (!quantity) throw new Error("Informe uma quantidade maior que zero.");
          const direction = kind === "loss" || str(form, "direction") === "out" ? -1 : 1;
          await mutate(
            "/inventory/adjustments",
            {
              ingredientId: selected,
              quantity: direction * quantity,
              kind,
              reason: str(form, "reason"),
              ...(str(form, "override") ? { overrideReason: str(form, "override") } : {}),
            },
            "POST",
            "inventory-adjust",
          );
          await onSaved();
          notify("Movimentação registrada no histórico.");
          onClose();
        }}
      >
        <Field label="Ingrediente">
          <select value={selected} onChange={(e) => setSelected(e.target.value)} required>
            {ingredients.map((i) => (
              <option value={i.id} key={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </Field>
        {ingredient && (
          <p className="muted">
            Físico: {displayQuantity(ingredient.physical, ingredient.unit)} · Reservado:{" "}
            {displayQuantity(ingredient.reserved, ingredient.unit)}
          </p>
        )}
        <Field label="Tipo de movimentação">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="initial">Entrada inicial</option>
            <option value="adjustment">Ajuste de inventário</option>
            <option value="loss">Perda física</option>
          </select>
        </Field>
        {kind === "adjustment" && (
          <Field label="Direção">
            <select name="direction">
              <option value="in">Entrada</option>
              <option value="out">Saída</option>
            </select>
          </Field>
        )}
        <div className="ops-form-grid">
          <Field label="Quantidade">
            <input name="quantity" inputMode="decimal" required />
          </Field>
          <Field label="Unidade da quantidade">
            <select name="unit" key={selected}>
              {ingredient?.unit === "g" ? (
                <>
                  <option value="g">g</option>
                  <option value="kg">kg</option>
                </>
              ) : ingredient?.unit === "ml" ? (
                <>
                  <option value="ml">ml</option>
                  <option value="l">L</option>
                </>
              ) : (
                <option value="un">un</option>
              )}
            </select>
          </Field>
        </div>
        <Field label="Justificativa">
          <textarea name="reason" required minLength={3} maxLength={500} />
        </Field>
        <Field label="Autorização de déficit (somente se necessária)">
          <textarea
            name="override"
            maxLength={500}
            placeholder="Justifique explicitamente uma falta diante das reservas."
          />
        </Field>
      </Form>
    </Modal>
  );
}

function Recipes({ ingredients }: { ingredients: Ingredient[] }) {
  const { data, auth, mutate, notify } = useStore();
  const [productId, setProductId] = useState(data.products[0]?.id || 0);
  const {
    value: versions,
    refresh,
    error,
  } = useOperationData<Recipe[]>(`/products/${productId}/recipes`, []);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<
    { ingredientId: string; quantity: string; unit: string }[]
  >([]);
  const [active, setActive] = useState(true);
  const newest = versions[0];
  function edit() {
    setRows(
      newest?.items.map((i) => ({
        ingredientId: i.ingredientId,
        quantity: String(i.quantity),
        unit: i.unit,
      })) || [],
    );
    setActive(newest?.active ?? true);
    setEditing(true);
  }
  return (
    <section className="panel ops-section">
      <div className="section-heading">
        <div>
          <h2>Fichas técnicas versionadas</h2>
          <p className="muted">
            Ingredientes por unidade vendida. Pedidos preservam a versão confirmada.
          </p>
        </div>
        {auth?.user.role === "admin" && (
          <button
            className="button primary"
            onClick={edit}
            disabled={!productId || !ingredients.length}
          >
            <Plus size={16} /> Nova versão
          </button>
        )}
      </div>
      <Field label="Produto da ficha técnica">
        <select value={productId} onChange={(e) => setProductId(Number(e.target.value))}>
          {data.products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
      {!versions.length ? (
        <Empty>Sem controle de estoque. Cadastre uma ficha técnica para ativá-lo.</Empty>
      ) : (
        versions.map((v) => (
          <details className="ops-history" key={v.id} open={v === newest}>
            <summary>
              Versão {v.version} · {v.active ? "Controle ativo" : "Controle desativado"} ·{" "}
              {dateTime(v.createdAt)}
            </summary>
            <ul>
              {v.items.map((i) => (
                <li key={i.ingredientId}>
                  {i.name}: <strong>{displayQuantity(i.quantity, i.unit)}</strong> por
                  produto
                </li>
              ))}
            </ul>
          </details>
        ))
      )}
      {editing && (
        <Modal title="Publicar nova versão da ficha" onClose={() => setEditing(false)}>
          <Form
            label="Publicar versão"
            onSubmit={async () => {
              if (active && !rows.length)
                throw new Error("Adicione ao menos um ingrediente.");
              await mutate(`/products/${productId}/recipes`, {
                active,
                items: rows.map((row) => ({
                  ingredientId: row.ingredientId,
                  quantity: quantityInBase(row.quantity, row.unit),
                })),
              });
              await refresh();
              notify("Ficha técnica publicada. Pedidos anteriores preservados.");
              setEditing(false);
            }}
          >
            <label className="check">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />{" "}
              Ativar controle de ingredientes
            </label>
            {rows.map((row, index) => (
              <div className="ops-recipe-row" key={index}>
                <Field label={`Ingrediente ${index + 1}`}>
                  <select
                    value={row.ingredientId}
                    onChange={(e) =>
                      setRows((old) =>
                        old.map((r, i) =>
                          i === index
                            ? {
                                ...r,
                                ingredientId: e.target.value,
                                unit:
                                  ingredients.find((x) => x.id === e.target.value)
                                    ?.unit || "g",
                              }
                            : r,
                        ),
                      )
                    }
                  >
                    {ingredients
                      .filter((i) => i.active || i.id === row.ingredientId)
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Quantidade por produto">
                  <input
                    required
                    value={row.quantity}
                    inputMode="decimal"
                    onChange={(e) =>
                      setRows((old) =>
                        old.map((r, i) =>
                          i === index ? { ...r, quantity: e.target.value } : r,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label="Unidade">
                  <select
                    value={row.unit}
                    onChange={(e) =>
                      setRows((old) =>
                        old.map((r, i) =>
                          i === index ? { ...r, unit: e.target.value } : r,
                        ),
                      )
                    }
                  >
                    {ingredients.find((i) => i.id === row.ingredientId)?.unit === "g" ? (
                      <>
                        <option value="g">g</option>
                        <option value="kg">kg</option>
                      </>
                    ) : ingredients.find((i) => i.id === row.ingredientId)?.unit ===
                      "ml" ? (
                      <>
                        <option value="ml">ml</option>
                        <option value="l">L</option>
                      </>
                    ) : (
                      <option value="un">un</option>
                    )}
                  </select>
                </Field>
                <button
                  type="button"
                  className="button subtle"
                  onClick={() => setRows((old) => old.filter((_, i) => i !== index))}
                >
                  Remover
                </button>
              </div>
            ))}
            <button
              className="button subtle"
              type="button"
              onClick={() => {
                const i = ingredients.find(
                  (x) => x.active && !rows.some((r) => r.ingredientId === x.id),
                );
                if (i)
                  setRows((old) => [
                    ...old,
                    { ingredientId: i.id, quantity: "", unit: i.unit },
                  ]);
              }}
              disabled={rows.length >= ingredients.filter((i) => i.active).length}
            >
              <Plus size={16} /> Adicionar ingrediente
            </button>
            <p className="muted">
              Publicar não altera reservas ou consumos anteriores. Quantidades devem ser
              exatas na unidade base.
            </p>
          </Form>
        </Modal>
      )}
    </section>
  );
}

export function InventoryPage() {
  const { auth } = useStore();
  const admin = auth?.user.role === "admin";
  const {
    value: ingredients,
    refresh,
    error,
    loading,
  } = useOperationData<Ingredient[]>("/inventory", []);
  const { value: suppliers } = useOperationData<Supplier[]>("/suppliers", []);
  const [tab, setTab] = useState("stock");
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<Ingredient | "new" | null>(null);
  const [adjust, setAdjust] = useState(false);
  const [page, setPage] = useState(1);
  const [movementIngredient, setMovementIngredient] = useState("");
  const { value: movements, error: movementError } = useOperationData<{
    items: Movement[];
    total: number;
    page: number;
    pageSize: number;
  }>(
    `/inventory/movements?page=${page}${movementIngredient ? `&ingredientId=${movementIngredient}` : ""}`,
    {
      items: [],
      total: 0,
      page: 1,
      pageSize: 30,
    },
  );
  const filtered = ingredients.filter((i) =>
    i.name.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR")),
  );
  const low = ingredients.filter((i) => i.active && i.available < i.minimum);
  return (
    <>
      <Heading
        eyebrow="OPERAÇÃO & INSUMOS"
        title="Estoque e fichas técnicas"
        description="Disponibilidade real, reservas e rastreabilidade de cada ingrediente."
      >
        <button className="button subtle" onClick={() => void refresh()}>
          <RefreshCw size={16} /> Atualizar
        </button>
        {admin && (
          <>
            <button
              className="button subtle"
              onClick={() => setAdjust(true)}
              disabled={!ingredients.length}
            >
              <PackagePlus size={16} /> Movimentar
            </button>
            <button className="button primary" onClick={() => setEditor("new")}>
              <Plus size={16} /> Ingrediente
            </button>
          </>
        )}
      </Heading>
      <div className="stats-grid">
        <article className="stat-card">
          <span>Ingredientes ativos</span>
          <strong>{ingredients.filter((i) => i.active).length}</strong>
          <small>Inventário centralizado</small>
        </article>
        <article className="stat-card">
          <span>Abaixo do mínimo</span>
          <strong>{low.length}</strong>
          <small>Considera o saldo disponível</small>
        </article>
        <article className="stat-card">
          <span>Com reservas</span>
          <strong>{ingredients.filter((i) => i.reserved > 0).length}</strong>
          <small>Destinados a pedidos confirmados</small>
        </article>
      </div>
      <nav className="ops-tabs" aria-label="Áreas de estoque">
        {[
          ["stock", "Ingredientes", Scale],
          ["recipes", "Fichas técnicas", ClipboardList],
          ["history", "Movimentações", PackagePlus],
        ].map(([key, title]) => (
          <button
            key={String(key)}
            className={`button ${tab === key ? "primary" : "subtle"}`}
            aria-pressed={tab === key}
            onClick={() => setTab(String(key))}
          >
            {String(title)}
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
      {tab === "stock" && (
        <section className="panel ops-section">
          <Field label="Pesquisar ingrediente">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nome do ingrediente"
            />
          </Field>
          {!filtered.length ? (
            <Empty>
              {loading
                ? "Carregando estoque…"
                : "Nenhum ingrediente cadastrado. Os produtos existentes continuam sem controle de estoque."}
            </Empty>
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
                    <th>Situação</th>
                    {admin && <th>Ação</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <strong>{i.name}</strong>
                        <small>
                          {suppliers.find((s) => s.id === i.preferredSupplierId)?.name ||
                            "Sem fornecedor preferencial"}
                        </small>
                      </td>
                      <td>{displayQuantity(i.physical, i.unit)}</td>
                      <td>{displayQuantity(i.reserved, i.unit)}</td>
                      <td className={i.available < i.minimum ? "ops-warning" : ""}>
                        {displayQuantity(i.available, i.unit)}
                      </td>
                      <td>{displayQuantity(i.minimum, i.unit)}</td>
                      <td>
                        <span className="badge">
                          {!i.active
                            ? "Inativo"
                            : i.available < 0
                              ? "Déficit autorizado"
                              : i.available < i.minimum
                                ? "Repor"
                                : "Regular"}
                        </span>
                      </td>
                      {admin && (
                        <td>
                          <button className="button subtle" onClick={() => setEditor(i)}>
                            Editar
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {tab === "recipes" && <Recipes ingredients={ingredients} />}
      {tab === "history" && (
        <section className="panel ops-section">
          <h2>Histórico imutável</h2>
          <Field label="Filtrar movimentações por ingrediente">
            <select
              value={movementIngredient}
              onChange={(e) => {
                setMovementIngredient(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              {ingredients.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </Field>
          {movementError && (
            <p role="alert" className="alert error">
              {movementError}
            </p>
          )}
          {!movements.items.length ? (
            <Empty>Nenhuma movimentação registrada.</Empty>
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Ingrediente</th>
                    <th>Operação</th>
                    <th>Quantidade</th>
                    <th>Responsável / motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.items.map((m) => (
                    <tr key={m.id}>
                      <td>{dateTime(m.createdAt)}</td>
                      <td>
                        {m.ingredientName ||
                          m.name ||
                          ingredients.find((i) => i.id === m.ingredientId)?.name}
                      </td>
                      <td>
                        {(
                          {
                            initial: "Entrada inicial",
                            adjustment: "Ajuste",
                            loss: "Perda",
                            consume: "Consumo",
                            receipt: "Recebimento",
                            reserve: "Reserva",
                            release: "Liberação",
                            waste: "Desperdício",
                          } as Record<string, string>
                        )[m.kind] || m.kind}
                      </td>
                      <td>
                        {m.kind === "reserve" || m.kind === "release"
                          ? displayQuantity(m.reservedDelta, m.unit)
                          : m.kind === "waste"
                            ? displayQuantity(m.wasteQuantity, m.unit)
                            : displayQuantity(m.quantity, m.unit)}
                        <small>
                          {m.kind === "reserve" || m.kind === "release"
                            ? "Variação da reserva"
                            : m.kind === "waste"
                              ? "Já consumido; sem nova baixa"
                              : "Variação do saldo físico"}
                        </small>
                      </td>
                      <td>
                        {m.userName}
                        <small>{m.reason}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="ops-pagination">
            <button
              className="button subtle"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </button>
            <span>
              Página {page} · {movements.total} registros
            </span>
            <button
              className="button subtle"
              disabled={page * movements.pageSize >= movements.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </button>
          </div>
        </section>
      )}
      {editor && (
        <IngredientEditor
          ingredient={editor === "new" ? undefined : editor}
          suppliers={suppliers}
          onClose={() => setEditor(null)}
          onSaved={refresh}
        />
      )}
      {adjust && (
        <StockEditor
          ingredients={ingredients.filter((i) => i.active)}
          onClose={() => setAdjust(false)}
          onSaved={refresh}
        />
      )}
    </>
  );
}
