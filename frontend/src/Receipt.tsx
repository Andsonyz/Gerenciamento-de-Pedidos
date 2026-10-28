import type { Order } from "@restaurante/shared";
import { tableName } from "./api";
export function Receipt({
  order,
  connected,
  busy,
  onViewed,
}: {
  order: Order;
  connected: boolean;
  busy: boolean;
  onViewed: () => void;
}) {
  return (
    <article className="receipt" aria-label={`Comanda ${order.number}`}>
      <div className="receipt-top">
        <span>COMANDA DE PEDIDO</span>
        <span className={`receipt-state ${order.status}`}>
          {order.status === "pending" ? "Pendente" : "Visualizada"}
        </span>
      </div>
      <div className="receipt-brand">mesa.</div>
      <p className="receipt-subtitle">COZINHA • IMPRESSORA VIRTUAL</p>
      <div className="receipt-divider" />
      <div className="receipt-title">
        <strong>#{String(order.number).padStart(4, "0")}</strong>
        <strong>{tableName(order.tableId)}</strong>
      </div>
      <time dateTime={order.createdAt}>
        {new Date(order.createdAt).toLocaleString("pt-BR")}
      </time>
      <div className="receipt-divider" />
      <p className="receipt-label">QTD / PRODUTO</p>
      <ul className="receipt-items">
        {order.items.map((item) => (
          <li key={item.productId}>
            <b>{item.quantity} ×</b>
            <span>{item.name}</span>
          </li>
        ))}
      </ul>
      {order.notes && (
        <>
          <div className="receipt-divider" />
          <p className="receipt-label">OBSERVAÇÕES</p>
          <p className="receipt-notes">{order.notes}</p>
        </>
      )}
      <div className="receipt-divider" />
      <p className="receipt-footer">
        {order.items.reduce((sum, item) => sum + item.quantity, 0)} itens • Fim
        da comanda
      </p>
      {order.status === "pending" ? (
        <button
          className="receipt-action"
          disabled={!connected || busy}
          onClick={onViewed}
        >
          {busy ? "Salvando…" : "Marcar como visualizada"}
        </button>
      ) : (
        <p className="viewed-message">✓ Comanda visualizada</p>
      )}
    </article>
  );
}
