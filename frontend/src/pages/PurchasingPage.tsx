import { useState } from "react";
import { Check, PackageCheck, Plus, RefreshCw, ShoppingBag, Truck } from "lucide-react";
import type { Page, Purchase } from "@restaurante/shared";
import { dateTime, money, parseCents } from "../api";
import { Empty, Field, Form, Heading, Modal, str } from "../components";
import { useStore } from "../state";
import {
  displayQuantity,
  quantityInBase,
  useOperationData,
  type Ingredient,
  type Supplier,
} from "./InventoryPage";

const purchaseLabels: Record<string, string> = {
  draft: "Rascunho",
  confirmed: "Confirmado",
  partially_received: "Recebido parcialmente",
  received: "Recebido",
  cancelled: "Saldo cancelado",
};
export function PurchasingPage() {
  const { auth, mutate, notify } = useStore();
  const admin = auth?.user.role === "admin";
  const {
    value: suppliers,
    refresh: refreshSuppliers,
    error: supplierError,
  } = useOperationData<Supplier[]>("/suppliers", []);
  const { value: ingredients } = useOperationData<Ingredient[]>("/inventory", []);
  const [page, setPage] = useState(1);
  const [supplierFilter, setSupplierFilter] = useState("");
  const [status, setStatus] = useState("");
  const {
    value: purchasePage,
    refresh,
    error,
  } = useOperationData<Page<Purchase>>(
    `/purchases?page=${page}${supplierFilter ? `&supplierId=${supplierFilter}` : ""}${status ? `&status=${status}` : ""}`,
    { items: [], total: 0, page: 1, pageSize: 50 },
  );
  const purchases = purchasePage.items;
  const [tab, setTab] = useState("purchases");
  const [supplierEditor, setSupplierEditor] = useState<Supplier | "new" | null>(null);
  const [purchaseEditor, setPurchaseEditor] = useState<Purchase | "new" | null>(null);
  const [selected, setSelected] = useState<Purchase | null>(null);
  const [action, setAction] = useState<"confirm" | "cancel" | "receive" | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [rows, setRows] = useState<
    { ingredientId: string; quantity: string; unit: string; total: string }[]
  >([]);
  const [search, setSearch] = useState("");
  function openPurchase(purchase: Purchase | "new") {
    setPurchaseEditor(purchase);
    setSupplierId(
      purchase === "new"
        ? suppliers.find((s) => s.active)?.id || ""
        : purchase.supplierId,
    );
    setRows(
      purchase === "new"
        ? []
        : purchase.items.map((i) => ({
            ingredientId: i.ingredientId,
            quantity: String(i.quantity),
            unit: i.unit,
            total: (i.totalCents / 100).toFixed(2).replace(".", ","),
          })),
    );
  }
  const current = selected
    ? purchases.find((p) => p.id === selected.id) || selected
    : null;
  const filtered = purchases;
  const pendingCount = purchases.filter((p) =>
    ["confirmed", "partially_received"].includes(p.status),
  ).length;
  return (
    <>
      <Heading
        eyebrow="ABASTECIMENTO"
        title="Compras e fornecedores"
        description="Planeje aquisições e registre somente os ingredientes efetivamente recebidos."
      >
        <button
          className="button subtle"
          onClick={() => {
            void refresh();
            void refreshSuppliers();
          }}
        >
          <RefreshCw size={16} /> Atualizar
        </button>
        {admin && (
          <>
            <button className="button subtle" onClick={() => setSupplierEditor("new")}>
              <Truck size={16} /> Fornecedor
            </button>
            <button
              className="button primary"
              disabled={!suppliers.some((s) => s.active) || !ingredients.length}
              onClick={() => {
                setSupplierId("");
                openPurchase("new");
              }}
            >
              <Plus size={16} /> Nova compra
            </button>
          </>
        )}
      </Heading>
      <div className="stats-grid">
        <article className="stat-card">
          <span>Compras aguardando entrada</span>
          <strong>{pendingCount}</strong>
          <small>Na página e filtros atuais</small>
        </article>
        <article className="stat-card">
          <span>Valor recebido nesta página</span>
          <strong>{money(purchases.reduce((sum, p) => sum + p.receivedCents, 0))}</strong>
          <small>Não representa pagamento ao fornecedor</small>
        </article>
        <article className="stat-card">
          <span>Fornecedores ativos</span>
          <strong>{suppliers.filter((s) => s.active).length}</strong>
          <small>Rede de abastecimento cadastrada</small>
        </article>
      </div>
      <nav className="ops-tabs" aria-label="Áreas de compras">
        <button
          className={`button ${tab === "purchases" ? "primary" : "subtle"}`}
          aria-pressed={tab === "purchases"}
          onClick={() => setTab("purchases")}
        >
          <ShoppingBag size={16} /> Pedidos de compra
        </button>
        <button
          className={`button ${tab === "suppliers" ? "primary" : "subtle"}`}
          aria-pressed={tab === "suppliers"}
          onClick={() => setTab("suppliers")}
        >
          <Truck size={16} /> Fornecedores
        </button>
      </nav>
      {(error || supplierError) && (
        <p role="alert" className="alert error">
          {error || supplierError}
        </p>
      )}
      {tab === "suppliers" ? (
        <section className="panel ops-section">
          <Field label="Pesquisar fornecedor">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
          {!suppliers.length ? (
            <Empty>Cadastre um fornecedor para iniciar o planejamento de compras.</Empty>
          ) : (
            <div className="ops-card-grid">
              {suppliers
                .filter((s) =>
                  s.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
                )
                .map((s) => (
                  <article key={s.id} className="ops-card">
                    <div className="line">
                      <h3>{s.name}</h3>
                      <span className="badge">{s.active ? "Ativo" : "Inativo"}</span>
                    </div>
                    <p>{s.phone || "Telefone não informado"}</p>
                    <p className="muted">{s.email || "E-mail não informado"}</p>
                    <small>
                      {s.ingredientIds
                        .map((id) => ingredients.find((i) => i.id === id)?.name)
                        .filter(Boolean)
                        .join(", ") || "Sem ingredientes associados"}
                    </small>
                    {admin && (
                      <button
                        className="button subtle"
                        onClick={() => setSupplierEditor(s)}
                      >
                        Editar fornecedor
                      </button>
                    )}
                  </article>
                ))}
            </div>
          )}
        </section>
      ) : (
        <section className="panel ops-section">
          <div className="ops-form-grid">
            <Field label="Filtrar compras por fornecedor">
              <select
                value={supplierFilter}
                onChange={(e) => {
                  setSupplierFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Todos</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Situação da compra">
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Todas</option>
                {Object.entries(purchaseLabels).map(([key, title]) => (
                  <option key={key} value={key}>
                    {title}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {!filtered.length ? (
            <Empty>
              Nenhuma compra encontrada. Criar uma compra ainda não movimenta o estoque.
            </Empty>
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Fornecedor / data</th>
                    <th>Situação</th>
                    <th>Total previsto</th>
                    <th>Recebido</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>
                          {suppliers.find((s) => s.id === p.supplierId)?.name ||
                            "Fornecedor"}
                        </strong>
                        <small>{dateTime(p.createdAt)}</small>
                      </td>
                      <td>
                        <span className="badge">
                          {purchaseLabels[p.status] || p.status}
                        </span>
                      </td>
                      <td>{money(p.totalCents)}</td>
                      <td>{money(p.receivedCents)}</td>
                      <td>
                        <button className="button subtle" onClick={() => setSelected(p)}>
                          Detalhes
                        </button>
                        {admin && p.status === "draft" && (
                          <button
                            className="button subtle"
                            onClick={() => openPurchase(p)}
                          >
                            Editar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {tab === "purchases" && (
        <div className="ops-pagination">
          <button
            className="button subtle"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Anterior
          </button>
          <span>
            Página {page} · {purchasePage.total} compras
          </span>
          <button
            className="button subtle"
            disabled={page * purchasePage.pageSize >= purchasePage.total}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </button>
        </div>
      )}
      {supplierEditor && (
        <Modal
          title={supplierEditor === "new" ? "Novo fornecedor" : "Editar fornecedor"}
          onClose={() => setSupplierEditor(null)}
        >
          <Form
            onSubmit={async (form) => {
              const existing = supplierEditor === "new" ? undefined : supplierEditor;
              await mutate(
                existing ? `/suppliers/${existing.id}` : "/suppliers",
                {
                  name: str(form, "name"),
                  phone: str(form, "phone"),
                  email: str(form, "email"),
                  active: form.has("active"),
                  ingredientIds: form.getAll("ingredient").map(String),
                },
                existing ? "PATCH" : "POST",
              );
              await refreshSuppliers();
              notify("Fornecedor salvo.");
              setSupplierEditor(null);
            }}
          >
            <Field label="Nome do fornecedor">
              <input
                name="name"
                required
                maxLength={120}
                defaultValue={supplierEditor === "new" ? "" : supplierEditor.name}
              />
            </Field>
            <Field label="Telefone">
              <input
                name="phone"
                type="tel"
                maxLength={40}
                defaultValue={supplierEditor === "new" ? "" : supplierEditor.phone}
              />
            </Field>
            <Field label="E-mail">
              <input
                name="email"
                type="email"
                maxLength={160}
                defaultValue={supplierEditor === "new" ? "" : supplierEditor.email}
              />
            </Field>
            <fieldset className="ops-check-list">
              <legend>Ingredientes fornecidos</legend>
              {!ingredients.length && (
                <p className="muted">Cadastre ingredientes para associá-los.</p>
              )}
              {ingredients.map((i) => (
                <label className="check" key={i.id}>
                  <input
                    type="checkbox"
                    name="ingredient"
                    value={i.id}
                    defaultChecked={
                      supplierEditor !== "new" &&
                      supplierEditor.ingredientIds.includes(i.id)
                    }
                  />
                  {i.name}
                </label>
              ))}
            </fieldset>
            <label className="check">
              <input
                type="checkbox"
                name="active"
                defaultChecked={supplierEditor === "new" || supplierEditor.active}
              />{" "}
              Fornecedor ativo
            </label>
          </Form>
        </Modal>
      )}
      {purchaseEditor && (
        <Modal
          title={
            purchaseEditor === "new"
              ? "Novo pedido de compra"
              : "Editar rascunho de compra"
          }
          onClose={() => {
            setPurchaseEditor(null);
            setSupplierId("");
          }}
        >
          <Form
            label="Salvar rascunho"
            onSubmit={async (form) => {
              if (!rows.length)
                throw new Error("Adicione ao menos um ingrediente à compra.");
              const body = {
                supplierId,
                notes: str(form, "notes"),
                items: rows.map((r) => ({
                  ingredientId: r.ingredientId,
                  quantity: quantityInBase(r.quantity, r.unit),
                  totalCents: parseCents(r.total),
                })),
              };
              await mutate(
                purchaseEditor === "new"
                  ? "/purchases"
                  : `/purchases/${purchaseEditor.id}`,
                body,
                purchaseEditor === "new" ? "POST" : "PATCH",
                "purchase-save",
              );
              setPurchaseEditor(null);
              setSupplierId("");
              await refresh();
              notify("Rascunho de compra salvo.");
            }}
          >
            <Field label="Fornecedor da compra">
              <select
                value={supplierId}
                required
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <option value="">Selecione</option>
                {suppliers
                  .filter((s) => s.active || s.id === supplierId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </Field>
            {rows.map((row, index) => (
              <div className="ops-purchase-row" key={index}>
                <Field label={`Ingrediente da compra ${index + 1}`}>
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
                <Field label="Quantidade comprada">
                  <input
                    required
                    inputMode="decimal"
                    value={row.quantity}
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
                <Field label="Valor total deste item (R$)">
                  <input
                    required
                    inputMode="decimal"
                    value={row.total}
                    onChange={(e) =>
                      setRows((old) =>
                        old.map((r, i) =>
                          i === index ? { ...r, total: e.target.value } : r,
                        ),
                      )
                    }
                  />
                </Field>
                <button
                  className="button subtle"
                  type="button"
                  onClick={() => setRows((old) => old.filter((_, i) => i !== index))}
                >
                  Remover
                </button>
              </div>
            ))}
            <button
              className="button subtle"
              type="button"
              disabled={rows.length >= ingredients.filter((i) => i.active).length}
              onClick={() => {
                const ingredient = ingredients.find(
                  (i) => i.active && !rows.some((r) => r.ingredientId === i.id),
                );
                if (ingredient)
                  setRows((old) => [
                    ...old,
                    {
                      ingredientId: ingredient.id,
                      quantity: "",
                      unit: ingredient.unit,
                      total: "",
                    },
                  ]);
              }}
            >
              <Plus size={16} /> Adicionar item
            </button>
            <Field label="Observações da compra">
              <textarea
                name="notes"
                maxLength={500}
                defaultValue={purchaseEditor === "new" ? "" : purchaseEditor.notes}
              />
            </Field>
            <p className="muted">
              Informe o valor total da quantidade adquirida, não o preço por grama ou
              mililitro. O estoque só aumenta após o recebimento.
            </p>
          </Form>
        </Modal>
      )}
      {current && !action && (
        <Modal title="Detalhes da compra" onClose={() => setSelected(null)}>
          <div className="ops-section">
            <div className="line">
              <h3>{suppliers.find((s) => s.id === current.supplierId)?.name}</h3>
              <span className="badge">{purchaseLabels[current.status]}</span>
            </div>
            <p className="muted">Criada em {dateTime(current.createdAt)}</p>
            {current.notes && <p>{current.notes}</p>}
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Ingrediente</th>
                    <th>Previsto</th>
                    <th>Recebido</th>
                    <th>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {current.items.map((i) => (
                    <tr key={i.id}>
                      <td>{i.ingredientName}</td>
                      <td>{displayQuantity(i.quantity, i.unit)}</td>
                      <td>{displayQuantity(i.receivedQuantity, i.unit)}</td>
                      <td>{money(i.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="line">
              <strong>Total: {money(current.totalCents)}</strong>
              <span>Recebido: {money(current.receivedCents)}</span>
            </div>
            <h3>Recebimentos preservados</h3>
            {!current.receipts.length ? (
              <p className="muted">Nenhum recebimento registrado.</p>
            ) : (
              current.receipts.map((r) => (
                <details className="ops-history" key={r.id}>
                  <summary>
                    {dateTime(r.createdAt)} · {r.userName}
                  </summary>
                  {r.items.map((i) => (
                    <p key={i.itemId}>
                      {current.items.find((x) => x.id === i.itemId)?.ingredientName}:{" "}
                      {i.quantity.toLocaleString("pt-BR")} · {money(i.totalCents)}
                    </p>
                  ))}
                </details>
              ))
            )}
            {admin && (
              <div className="ops-actions">
                {current.status === "draft" && (
                  <button className="button primary" onClick={() => setAction("confirm")}>
                    <Check size={16} /> Confirmar compra
                  </button>
                )}
                {["confirmed", "partially_received"].includes(current.status) && (
                  <button className="button primary" onClick={() => setAction("receive")}>
                    <PackageCheck size={16} /> Registrar recebimento
                  </button>
                )}
                {!["received", "cancelled"].includes(current.status) && (
                  <button className="button danger" onClick={() => setAction("cancel")}>
                    Cancelar saldo
                  </button>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}
      {current && action && (
        <Modal
          title={
            action === "receive"
              ? "Registrar recebimento parcial ou total"
              : action === "cancel"
                ? "Cancelar saldo não recebido"
                : "Confirmar pedido de compra"
          }
          onClose={() => setAction(null)}
        >
          <Form
            label={
              action === "receive"
                ? "Confirmar entrada no estoque"
                : action === "cancel"
                  ? "Confirmar cancelamento"
                  : "Confirmar compra"
            }
            danger={action === "cancel"}
            onSubmit={async (form) => {
              const body: Record<string, unknown> = {};
              if (action === "cancel") body.reason = str(form, "reason");
              if (action === "receive") {
                body.items = current.items
                  .filter((i) => i.receivedQuantity < i.quantity)
                  .map((i) => ({
                    itemId: i.id,
                    quantity: quantityInBase(str(form, i.id) || "0", i.unit),
                  }))
                  .filter((i) => i.quantity > 0);
                if (!(body.items as unknown[]).length)
                  throw new Error("Informe ao menos uma quantidade recebida.");
              }
              await mutate(
                `/purchases/${current.id}/${action}`,
                body,
                "POST",
                `purchase-${action}-${current.id}`,
              );
              await refresh();
              notify(
                action === "receive"
                  ? "Recebimento registrado no estoque."
                  : "Compra atualizada.",
              );
              setAction(null);
            }}
          >
            {action === "receive" ? (
              current.items
                .filter((i) => i.receivedQuantity < i.quantity)
                .map((i) => (
                  <Field
                    key={i.id}
                    label={`${i.ingredientName} (${i.unit}) — restante ${i.quantity - i.receivedQuantity}`}
                  >
                    <input
                      name={i.id}
                      type="number"
                      min="0"
                      max={i.quantity - i.receivedQuantity}
                      step="1"
                      defaultValue="0"
                    />
                  </Field>
                ))
            ) : (
              <p>
                {action === "cancel"
                  ? "Somente a quantidade ainda não recebida será cancelada. As entradas anteriores permanecem no histórico."
                  : "Esta confirmação registra o compromisso de compra. O estoque permanece inalterado até o recebimento."}
              </p>
            )}
            {action === "cancel" && (
              <Field label="Motivo do cancelamento">
                <textarea name="reason" required minLength={3} maxLength={500} />
              </Field>
            )}
          </Form>
        </Modal>
      )}
    </>
  );
}
