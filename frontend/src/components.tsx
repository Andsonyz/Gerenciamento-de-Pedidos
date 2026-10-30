import {
  useEffect,
  useId,
  useRef,
  useState,
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type FormEvent,
  type ReactNode,
} from "react";
import { X, LoaderCircle, Check, AlertTriangle } from "lucide-react";
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <dialog ref={dialog} className="modal" onCancel={onClose} aria-labelledby={titleId}>
      <div className="modal-heading">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" aria-label="Fechar diálogo" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Form({
  children,
  onSubmit,
  label = "Salvar",
  danger = false,
}: {
  children?: ReactNode;
  onSubmit: (form: FormData) => Promise<void>;
  label?: string;
  danger?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await onSubmit(form);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível concluir.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(event) => {
        void submit(event);
      }}
      className="form"
    >
      {children}
      {error && (
        <div role="alert" className="alert error">
          <AlertTriangle size={17} />
          {error}
        </div>
      )}
      <button
        className={danger ? "button danger" : "button primary"}
        disabled={busy}
        type="submit"
      >
        {busy ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}{" "}
        {busy ? "Processando…" : label}
      </button>
    </form>
  );
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  const labelId = useId();
  return (
    <label className="field">
      <span id={labelId}>{label}</span>
      {Children.map(children, (child) =>
        isValidElement(child) &&
        ["input", "select", "textarea"].includes(String(child.type))
          ? cloneElement(child as ReactElement<{ "aria-labelledby"?: string }>, {
              "aria-labelledby": labelId,
            })
          : child,
      )}
    </label>
  );
}
export function Empty({
  children = "Nenhum registro por aqui.",
}: {
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">—</span>
      <p>{children}</p>
    </div>
  );
}
export function Heading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  );
}
export const statusLabel: Record<string, string> = {
  available: "Disponível",
  occupied: "Ocupada",
  awaiting_payment: "Aguardando pagamento",
  reserved: "Reservada",
  unavailable: "Indisponível",
  received: "Recebido",
  preparing: "Em preparo",
  ready: "Pronto",
  delivered: "Entregue",
  cancelled: "Cancelado",
  pending: "Pendente",
  approved: "Aprovado",
  rejected: "Rejeitado",
  open: "Aberta",
  closed: "Encerrada",
  displayed: "Exibido",
  failed: "Falhou",
  admin: "Administrador",
  cashier: "Caixa",
  waiter: "Garçom",
  kitchen: "Cozinha",
};
export function Badge({ status }: { status: string }) {
  return (
    <span className={`badge status-${status}`}>{statusLabel[status] || status}</span>
  );
}
export const str = (form: FormData, name: string) => String(form.get(name) || "").trim();
