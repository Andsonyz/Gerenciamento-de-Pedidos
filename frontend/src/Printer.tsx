import { useState } from "react";
import { api } from "./api";
import { Receipt } from "./Receipt";
import { usePrinter } from "./usePrinter";

export function Printer() {
  const { orders, connected, paused, hasSynced, toggleConnection } =
    usePrinter();
  const [filter, setFilter] = useState<"all" | "pending" | "viewed">("all");
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const pending = orders.filter((order) => order.status === "pending").length;
  const visible = orders.filter(
    (order) => filter === "all" || order.status === filter,
  );
  async function markViewed(id: string) {
    if (!connected || busy.has(id)) return;
    setBusy((current) => new Set(current).add(id));
    setError("");
    try {
      await api(`/orders/${id}/viewed`, { method: "PATCH" });
    } catch {
      setError(
        "Não foi possível confirmar a visualização. Reconecte e tente novamente.",
      );
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">COZINHA EM TEMPO REAL</p>
          <h1>Impressora Virtual</h1>
          <p>Cada pedido no seu lugar. As comandas chegam automaticamente.</p>
        </div>
        <span className={`connection-tag ${connected ? "online" : "offline"}`}>
          <i />
          {paused
            ? "Conexão pausada"
            : connected
              ? "Conectada"
              : "Reconectando…"}
        </span>
      </div>
      <div className="printer-stats">
        <div>
          <span>Pendentes</span>
          <strong>{pending.toString().padStart(2, "0")}</strong>
          <small>Aguardando visualização</small>
        </div>
        <div>
          <span>Visualizadas</span>
          <strong>
            {(orders.length - pending).toString().padStart(2, "0")}
          </strong>
          <small>Guardadas no histórico</small>
        </div>
        <div>
          <span>Total de comandas</span>
          <strong>{orders.length.toString().padStart(2, "0")}</strong>
          <small>Salvas neste servidor</small>
        </div>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {!connected && (
        <div className="notice warning">
          {paused
            ? "Simulação ativa. Novos pedidos continuam salvos no servidor e aparecerão ao reconectar."
            : "Aguardando conexão com o servidor. A lista será sincronizada automaticamente."}
        </div>
      )}
      <div className="printer-toolbar">
        <div className="category-list" aria-label="Filtrar comandas">
          {(
            [
              ["all", "Todas"],
              ["pending", "Pendentes"],
              ["viewed", "Visualizadas"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              className={`chip ${filter === key ? "active" : ""}`}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <button className="secondary-button" onClick={toggleConnection}>
          {paused ? "Reconectar impressora" : "Simular falha de conexão"}
        </button>
      </div>
      <div className="printer-canvas">
        {visible.length ? (
          <div className="receipt-grid">
            {visible.map((order) => (
              <Receipt
                key={order.id}
                order={order}
                connected={connected}
                busy={busy.has(order.id)}
                onViewed={() => void markViewed(order.id)}
              />
            ))}
          </div>
        ) : (
          <div className="printer-empty">
            <span aria-hidden="true">▤</span>
            <h2>
              {!hasSynced
                ? "Conectando à cozinha…"
                : filter === "all"
                  ? "Pronta para o primeiro pedido"
                  : "Nenhuma comanda neste filtro"}
            </h2>
            <p>
              {filter === "all"
                ? "Os pedidos confirmados pelos garçons aparecerão aqui."
                : "As comandas continuam disponíveis nos outros filtros."}
            </p>
          </div>
        )}
      </div>
      <p className="printer-footnote">
        Comanda virtual de 80 mm • Histórico persistente • Visualização
        compartilhada entre dispositivos
      </p>
    </>
  );
}
