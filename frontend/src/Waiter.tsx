import { useEffect, useRef, useState } from "react";
import type { CreateOrder, Order, Product, Table } from "@restaurante/shared";
import { api, ApiError, money, tableName } from "./api";
import { clearPending, createRequestId, readPending, savePending } from "./submission";

interface InitialState {
  pending: CreateOrder | null;
  error: string;
}
function initialState(): InitialState {
  try {
    return { pending: readPending(), error: "" };
  } catch {
    return {
      pending: null,
      error:
        "Não foi possível acessar o envio salvo. Habilite o armazenamento local e confira a impressora antes de limpar os dados do navegador.",
    };
  }
}

export function Waiter() {
  const [initial] = useState(initialState);
  const [tables, setTables] = useState<Table[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [tableId, setTableId] = useState<number | null>(initial.pending?.tableId ?? null);
  const [quantities, setQuantities] = useState<Record<number, number>>(() =>
    Object.fromEntries(
      initial.pending?.items.map((item) => [item.productId, item.quantity]) ?? [],
    ),
  );
  const [notes, setNotes] = useState(initial.pending?.notes ?? "");
  const [category, setCategory] = useState("Todos");
  const [pending, setPending] = useState(initial.pending);
  const [sending, setSending] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState(initial.error);
  const [catalogError, setCatalogError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [success, setSuccess] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setCatalogError("");
    Promise.all([api<Table[]>("/tables"), api<Product[]>("/products")])
      .then(([nextTables, nextProducts]) => {
        if (active) {
          setTables(nextTables);
          setProducts(nextProducts);
        }
      })
      .catch(() => {
        if (active)
          setCatalogError(
            "Não foi possível carregar o cardápio. Verifique a conexão com o servidor local.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reload]);

  const locked = sending || !!pending || !!initial.error;
  const selected = products.filter((product) => (quantities[product.id] ?? 0) > 0);
  const count = Object.values(quantities).reduce((sum, quantity) => sum + quantity, 0);
  const total = selected.reduce(
    (sum, product) => sum + product.priceCents * (quantities[product.id] ?? 0),
    0,
  );
  function changeQuantity(productId: number, delta: number) {
    if (locked) return;
    setQuantities((current) => ({
      ...current,
      [productId]: Math.min(99, Math.max(0, (current[productId] ?? 0) + delta)),
    }));
    setSuccess("");
  }
  async function submit() {
    if (busy.current || !tableId || count === 0 || initial.error) return;
    busy.current = true;
    setSending(true);
    setError("");
    setSuccess("");
    let saved = false;
    let requestId: string | null = null;
    try {
      const body: CreateOrder = pending ?? {
        requestId: createRequestId(),
        tableId,
        items: selected.map((product) => ({
          productId: product.id,
          quantity: quantities[product.id]!,
        })),
        notes: notes.trim(),
      };
      requestId = body.requestId;
      savePending(body); // Write before sending: even a reload after a lost response retains the key.
      saved = true;
      setPending(body);
      const order = await api<Order>("/orders", {
        method: "POST",
        body: JSON.stringify(body),
      });
      clearPending(body.requestId);
      setPending(null);
      setQuantities({});
      setNotes("");
      setSuccess(
        `Pedido #${String(order.number).padStart(4, "0")} confirmado para ${tableName(order.tableId)}. Comanda disponível na impressora.`,
      );
    } catch (failure) {
      if (failure instanceof ApiError && [400, 413].includes(failure.status)) {
        try {
          if (requestId) clearPending(requestId);
          setPending(null);
        } catch {
          /* Keep locked if local storage cannot be cleared. */
        }
        setError(failure.message);
      } else if (!saved) {
        setError(
          "Não foi possível salvar a chave de envio neste navegador. Habilite o armazenamento local para enviar com segurança.",
        );
      } else {
        setError(
          "Não foi possível confirmar o envio. O pedido pode já estar salvo. Tente novamente: a mesma chave evita duplicação.",
        );
      }
    } finally {
      busy.current = false;
      setSending(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ATENDIMENTO</p>
          <h1>Um bom pedido começa aqui.</h1>
          <p>Escolha a mesa, monte o pedido e envie para a cozinha.</p>
        </div>
        <span className="quiet-tag">Cardápio de demonstração</span>
      </div>
      {catalogError && (
        <div className="notice error" role="alert">
          {catalogError}
          <button className="text-button" onClick={() => setReload((value) => value + 1)}>
            Tentar carregar novamente
          </button>
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {success && (
        <div className="notice success" role="status">
          ✓ {success}
        </div>
      )}
      {pending && !sending && (
        <div className="notice warning">
          Há um envio aguardando confirmação. Confira os itens abaixo e tente enviá-lo
          novamente.
        </div>
      )}
      <section className="panel tables-panel" aria-labelledby="tables-heading">
        <div className="section-heading">
          <div className="flex items-center gap-3">
            <span className="step">1</span>
            <h2 id="tables-heading">Escolha a mesa</h2>
          </div>
          <span className="muted text-sm">
            {tableId ? `${tableName(tableId)} selecionada` : "Nenhuma selecionada"}
          </span>
        </div>
        {loading ? (
          <p className="muted py-4">Carregando mesas…</p>
        ) : (
          <div className="table-grid">
            {tables.map((table) => (
              <button
                key={table.id}
                className={`table-button ${tableId === table.id ? "selected" : ""}`}
                aria-label={table.name}
                aria-pressed={tableId === table.id}
                disabled={locked}
                onClick={() => {
                  setTableId(table.id);
                  setSuccess("");
                }}
              >
                <span className="table-symbol" aria-hidden="true">
                  ▦
                </span>
                <span>{table.name}</span>
              </button>
            ))}
          </div>
        )}
      </section>
      <div className="waiter-layout">
        <section className="panel menu-panel" aria-labelledby="menu-heading">
          <div className="section-heading">
            <div className="flex items-center gap-3">
              <span className="step">2</span>
              <h2 id="menu-heading">Monte o pedido</h2>
            </div>
            <span className="muted text-sm">{products.length} produtos</span>
          </div>
          <div className="category-list" aria-label="Categorias do cardápio">
            {["Todos", ...new Set(products.map((product) => product.category))].map(
              (value) => (
                <button
                  key={value}
                  className={`chip ${value === category ? "active" : ""}`}
                  aria-pressed={category === value}
                  onClick={() => setCategory(value)}
                >
                  {value}
                </button>
              ),
            )}
          </div>
          {loading ? (
            <p className="muted py-8">Carregando cardápio…</p>
          ) : (
            <div className="product-list">
              {products
                .filter(
                  (product) => category === "Todos" || product.category === category,
                )
                .map((product) => (
                  <div className="product" key={product.id}>
                    <span
                      className={`product-icon category-${product.category}`}
                      aria-hidden="true"
                    >
                      {product.category === "Bebidas"
                        ? "◡"
                        : product.category === "Sobremesas"
                          ? "◇"
                          : product.category === "Porções"
                            ? "▤"
                            : "◉"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="product-category">{product.category}</p>
                      <h3>{product.name}</h3>
                      <p className="price">{money(product.priceCents)}</p>
                    </div>
                    <button
                      className="add-button"
                      aria-label={`Adicionar ${product.name}`}
                      disabled={locked || (quantities[product.id] ?? 0) >= 99}
                      onClick={() => changeQuantity(product.id, 1)}
                    >
                      +
                    </button>
                  </div>
                ))}
            </div>
          )}
        </section>
        <aside className="panel order-panel" aria-labelledby="order-heading">
          <div className="section-heading">
            <div className="flex items-center gap-3">
              <span className="step">3</span>
              <h2 id="order-heading">Seu pedido</h2>
            </div>
            <span className="count-badge">{count}</span>
          </div>
          <div className="order-table">
            {tableId ? tableName(tableId) : "Selecione uma mesa"}
            <span>
              {count} {count === 1 ? "item" : "itens"}
            </span>
          </div>
          {selected.length === 0 ? (
            <div className="empty-cart">
              <span aria-hidden="true">☷</span>
              <h3>A comanda está em branco</h3>
              <p>
                Adicione os produtos do cardápio
                <br />
                para começar o pedido.
              </p>
            </div>
          ) : (
            <ul className="cart-list">
              {selected.map((product) => (
                <li key={product.id}>
                  <div className="flex justify-between gap-3">
                    <h3>{product.name}</h3>
                    <button
                      className="remove-button"
                      aria-label={`Remover ${product.name}`}
                      disabled={locked}
                      onClick={() =>
                        setQuantities((current) => ({
                          ...current,
                          [product.id]: 0,
                        }))
                      }
                    >
                      ×
                    </button>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="quantity">
                      <button
                        aria-label={`Diminuir ${product.name}`}
                        disabled={locked}
                        onClick={() => changeQuantity(product.id, -1)}
                      >
                        −
                      </button>
                      <span>{quantities[product.id]}</span>
                      <button
                        aria-label={`Aumentar ${product.name}`}
                        disabled={locked || quantities[product.id] === 99}
                        onClick={() => changeQuantity(product.id, 1)}
                      >
                        +
                      </button>
                    </div>
                    <span className="text-sm font-semibold">
                      {money(product.priceCents * quantities[product.id]!)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <label className="notes-label" htmlFor="notes">
            Observações do pedido <span>opcional</span>
          </label>
          <textarea
            id="notes"
            maxLength={500}
            rows={3}
            placeholder="Ex.: sem cebola, molho à parte…"
            disabled={locked}
            value={notes}
            onChange={(event) => {
              setNotes(event.target.value);
              setSuccess("");
            }}
          />
          <div className="text-right text-xs muted mt-1">{notes.length}/500</div>
          <div className="order-total">
            <span>Total do pedido</span>
            <strong>{money(total)}</strong>
          </div>
          <button
            className="primary-button w-full"
            disabled={
              sending ||
              !tableId ||
              count === 0 ||
              loading ||
              !!catalogError ||
              !!initial.error
            }
            onClick={() => void submit()}
          >
            {sending
              ? "Enviando pedido…"
              : pending
                ? "Tentar envio novamente"
                : "Confirmar pedido"}
            <span aria-hidden="true">→</span>
          </button>
          <p className="order-hint">
            {!tableId
              ? "Selecione uma mesa para continuar."
              : "A comanda será enviada à impressora virtual."}
          </p>
        </aside>
      </div>
    </>
  );
}
