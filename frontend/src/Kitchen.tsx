import { useEffect, useRef, useState } from "react";
import { CheckCheck, ChefHat, RotateCcw, Unplug, Wifi } from "lucide-react";
import type { PrintJob } from "@restaurante/shared";
import { useStore } from "./state";
import { Badge, Empty, Field, Form, Heading, Modal, str } from "./components";
import { dateTime } from "./api";
function cancellationContext(job: PrintJob, all: PrintJob[]): boolean {
  const visited = new Set<string>();
  let current: PrintJob | undefined = job;
  while (current && !visited.has(current.id)) {
    if (current.type === "cancellation") return true;
    visited.add(current.id);
    current = all.find((item) => item.id === current!.sourceJobId);
  }
  return false;
}
export function KitchenPage() {
  const { data, mutate, connected, notify, reload, setRealtimePaused } = useStore();
  const [printerOnline, setPrinterOnline] = useState(
    () => localStorage.getItem("mesa.printer.connected") !== "false",
  );
  const [tab, setTab] = useState("all");
  const [reprint, setReprint] = useState<PrintJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const working = useRef(new Set<string>());
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  const jobs = [...new Map(data.printJobs.map((job) => [job.id, job])).values()].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt),
  );
  useEffect(() => {
    localStorage.setItem("mesa.printer.connected", String(printerOnline));
  }, [printerOnline]);
  useEffect(() => {
    setRealtimePaused(!printerOnline);
    return () => setRealtimePaused(false);
  }, [printerOnline, setRealtimePaused]);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    if (!printerOnline || !connected || busy || !visible) return;
    for (const job of data.printJobs.filter(
      (item) =>
        (item.status === "pending" || item.status === "failed") &&
        (tab === "all" || tab === item.status),
    )) {
      if (working.current.has(job.id)) continue;
      working.current.add(job.id);
      void mutate(`/print-jobs/${job.id}`, { status: "displayed" }, "PATCH")
        .catch((cause) =>
          setError(cause instanceof Error ? cause.message : "Falha na exibição."),
        )
        .finally(() => working.current.delete(job.id));
    }
  }, [data.printJobs, printerOnline, connected, mutate, busy, visible, tab]);
  async function recover() {
    setBusy(true);
    setError("");
    setPrinterOnline(true);
    setRealtimePaused(false);
    try {
      await reload(true);
      notify(
        "Conexão recuperada. A fila foi consultada novamente, sem duplicar pedidos.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Não foi possível recuperar a fila.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function fail() {
    setPrinterOnline(false);
    setRealtimePaused(true);
    setBusy(true);
    setError("");
    try {
      for (const job of jobs.filter((item) => item.status === "pending"))
        await mutate(`/print-jobs/${job.id}`, { status: "failed" }, "PATCH");
      await reload(true);
      notify("Impressora virtual desconectada. Trabalhos futuros permanecerão na fila.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao registrar situação.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        eyebrow="OPERAÇÃO EM TEMPO REAL"
        title="Central de Impressão — Cozinha"
        description="Comandas de 80 mm. Cada pedido, no ritmo certo."
      >
        <span className={`connection-pill ${printerOnline && connected ? "online" : ""}`}>
          {printerOnline && connected ? <Wifi size={15} /> : <Unplug size={15} />}{" "}
          {printerOnline && connected
            ? "Impressora virtual conectada"
            : "Impressora virtual desconectada"}
        </span>
      </Heading>
      <div className="kitchen-toolbar panel">
        <div>
          <strong>Fila persistente de comandas</strong>
          <p className="muted small">
            A exibição confirma o recebimento. Uma reimpressão gera um novo comprovante
            identificado.
          </p>
        </div>
        <div className="button-row">
          <button
            className="button"
            disabled={busy}
            onClick={() => {
              void fail();
            }}
          >
            <Unplug size={16} /> Simular desconexão
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => {
              void recover();
            }}
          >
            <RotateCcw size={16} /> Reconectar e recuperar fila
          </button>
        </div>
      </div>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      <div className="category-tabs">
        {[
          ["all", "Todas"],
          ["pending", "Pendentes"],
          ["displayed", "Exibidas"],
          ["failed", "Falhas"],
        ].map(([value, label]) => (
          <button
            key={value}
            className={`chip ${tab === value ? "active" : ""}`}
            onClick={() => setTab(value!)}
          >
            {label}{" "}
            {value !== "all" && (
              <span>{jobs.filter((job) => job.status === value).length}</span>
            )}
          </button>
        ))}
      </div>
      <div className="kitchen-grid">
        {jobs
          .filter((job) => tab === "all" || job.status === tab)
          .map((job) => (
            <article
              key={job.id}
              className={`kitchen-card ${cancellationContext(job, jobs) ? "cancellation-card" : ""}`}
            >
              <div className="receipt-paper">
                <div className="receipt-top">
                  <ChefHat size={22} />
                  <strong>{data.settings.name}</strong>
                  <span>COZINHA · COMANDA 80 MM</span>
                </div>
                <p className="receipt-type">
                  {cancellationContext(job, jobs) ? "CANCELAMENTO" : "PEDIDO"}
                  {job.type === "reprint" ? " · REIMPRESSÃO" : ""}
                </p>
                <div className="receipt-number">
                  <span>#{String(job.orderNumber).padStart(3, "0")}</span>
                  <strong>MESA {String(job.tableId).padStart(2, "0")}</strong>
                </div>
                <p className="receipt-date">{dateTime(job.createdAt)}</p>
                <div className="receipt-items">
                  {job.items.map((item, index) => (
                    <div key={`${item.name}-${index}`}>
                      <strong>{item.quantity}×</strong>
                      <span>{item.name}</span>
                    </div>
                  ))}
                </div>
                {job.notes && (
                  <div className="receipt-note">
                    <strong>OBSERVAÇÕES</strong>
                    <p>{job.notes}</p>
                  </div>
                )}
                {job.reason && (
                  <div className="receipt-note">
                    <strong>MOTIVO</strong>
                    <p>{job.reason}</p>
                  </div>
                )}
                <div className="receipt-bottom">
                  {job.type === "reprint" && <span>Origem: {job.sourceJobId}</span>}
                  <span>Comprovante {job.id}</span>
                  <span>SEM VALOR FISCAL</span>
                </div>
              </div>
              <div className="kitchen-card-actions">
                <div className="line">
                  <Badge status={job.status} />
                  <Badge status={job.orderStatus} />
                </div>
                {!cancellationContext(job, jobs) &&
                  job.orderStatus !== "cancelled" &&
                  job.orderStatus !== "delivered" && (
                    <Form
                      label={
                        job.orderStatus === "received"
                          ? "Iniciar preparo"
                          : job.orderStatus === "preparing"
                            ? "Marcar pronto"
                            : "Confirmar entrega"
                      }
                      onSubmit={async () => {
                        const status =
                          job.orderStatus === "received"
                            ? "preparing"
                            : job.orderStatus === "preparing"
                              ? "ready"
                              : "delivered";
                        await mutate(
                          `/orders/${job.orderId}/status`,
                          { status },
                          "PATCH",
                        );
                        notify("Etapa do pedido atualizada.");
                      }}
                    ></Form>
                  )}
                <div className="button-row">
                  {job.status === "failed" || job.status === "pending" ? (
                    <button
                      className="button ghost"
                      disabled={!printerOnline || busy}
                      onClick={() => {
                        void mutate(
                          `/print-jobs/${job.id}`,
                          { status: "displayed" },
                          "PATCH",
                        ).catch((cause) => setError(String(cause)));
                      }}
                    >
                      <CheckCheck size={15} /> Confirmar exibição
                    </button>
                  ) : (
                    <button className="button ghost" onClick={() => setReprint(job)}>
                      <RotateCcw size={15} /> Reimprimir
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
      </div>
      {!jobs.filter((job) => tab === "all" || job.status === tab).length && (
        <Empty>Sem comandas nesta fila. Novos pedidos aparecerão automaticamente.</Empty>
      )}
      {reprint && (
        <Modal
          title={`Reimprimir pedido #${reprint.orderNumber}`}
          onClose={() => setReprint(null)}
        >
          <Form
            label="Confirmar reimpressão"
            onSubmit={async (form) => {
              await mutate(
                `/print-jobs/${reprint.id}/reprint`,
                { reason: str(form, "reason") },
                "POST",
                `reprint:${reprint.id}`,
              );
              notify("Nova cópia adicionada à fila.");
              setReprint(null);
            }}
          >
            <p className="muted">
              O novo comprovante identifica a reimpressão e preserva a indicação de
              cancelamento quando aplicável.
            </p>
            <Field label="Justificativa">
              <textarea name="reason" required minLength={3} />
            </Field>
          </Form>
        </Modal>
      )}
    </>
  );
}
