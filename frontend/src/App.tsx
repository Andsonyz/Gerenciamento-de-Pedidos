import { useEffect, useState, type ReactNode } from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import {
  Armchair,
  ArrowRight,
  ChefHat,
  CircleHelp,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sun,
  Users,
  UtensilsCrossed,
  X,
  History,
  Wifi,
  WifiOff,
  Download,
  AlertTriangle,
} from "lucide-react";
import type { Role } from "@restaurante/shared";
import { StoreProvider, useStore, type PendingOperation } from "./state";
import { DashboardPage, CatalogPage, UsersPage, AuditPage, SettingsPage } from "./Admin";
import { HistoryPage, TablesPage } from "./Tables";
import { OrdersPage } from "./Orders";
import { KitchenPage } from "./Kitchen";
import { Empty, Field, Form, Modal, statusLabel } from "./components";
import { dateTime, money } from "./api";
const management: Role[] = ["admin", "cashier"];
const navigation = [
  {
    to: "/painel",
    label: "Visão geral",
    icon: LayoutDashboard,
    roles: management,
  },
  {
    to: "/mesas",
    label: "Mesas",
    icon: Armchair,
    roles: ["admin", "cashier", "waiter"],
  },
  {
    to: "/pedidos",
    label: "Pedidos",
    icon: ClipboardList,
    roles: ["admin", "cashier", "waiter"],
  },
  { to: "/historico", label: "Histórico", icon: History, roles: management },
  {
    to: "/cozinha",
    label: "Central de Impressão",
    icon: ChefHat,
    roles: ["admin", "kitchen"],
  },
  {
    to: "/catalogo",
    label: "Catálogo",
    icon: UtensilsCrossed,
    roles: ["admin"],
  },
  { to: "/usuarios", label: "Equipe", icon: Users, roles: ["admin"] },
  { to: "/auditoria", label: "Auditoria", icon: ShieldCheck, roles: ["admin"] },
  {
    to: "/configuracoes",
    label: "Configurações",
    icon: Settings,
    roles: ["admin"],
  },
];
function home(role: Role) {
  return role === "waiter" ? "/mesas" : role === "kitchen" ? "/cozinha" : "/painel";
}
function Guard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { auth } = useStore();
  return auth && roles.includes(auth.user.role) ? (
    children
  ) : (
    <Navigate to={auth ? home(auth.user.role) : "/"} replace />
  );
}
export function App() {
  return (
    <BrowserRouter>
      <StoreProvider>
        <AuthenticatedApp />
      </StoreProvider>
    </BrowserRouter>
  );
}
function AuthenticatedApp() {
  const { auth, initializing } = useStore();
  if (initializing)
    return (
      <div className="loading-screen">
        <div className="brand">
          mesa<span>.</span>
        </div>
        <RefreshCw className="spin gold" size={23} />
        <p>Preparando o atendimento…</p>
      </div>
    );
  return auth ? <Shell /> : <Login />;
}
function Login() {
  const { login } = useStore();
  return (
    <div className="login-screen">
      <section className="login-story">
        <Link className="brand" to="/">
          mesa<span>.</span>
        </Link>
        <div className="login-art" aria-hidden="true">
          <div className="plate">
            <div />
            <span />
            <i />
          </div>
        </div>
        <div>
          <p className="eyebrow">HOSPITALIDADE EM CADA DETALHE</p>
          <h1>
            O cuidado de servir.
            <br />
            <em>A clareza de gerir.</em>
          </h1>
          <p>
            Do primeiro pedido ao último detalhe.
            <br />
            Seu restaurante, em perfeita sintonia.
          </p>
        </div>
        <span className="login-footnote">GESTÃO DO SALÃO · COZINHA · ATENDIMENTO</span>
      </section>
      <section className="login-form-panel">
        <div className="login-mobile-brand brand">
          mesa<span>.</span>
        </div>
        <div className="login-form-inner">
          <p className="eyebrow">BEM-VINDO À MESA</p>
          <h2>Entre para começar.</h2>
          <p className="muted">Use seu acesso individual ao restaurante.</p>
          <Form
            label="Entrar no restaurante"
            onSubmit={async (form) => {
              await login(
                String(form.get("username") || ""),
                String(form.get("password") || ""),
              );
            }}
          >
            <Field label="Usuário">
              <input
                name="username"
                autoComplete="username"
                autoFocus
                required
                placeholder="Seu nome de usuário"
              />
            </Field>
            <Field label="Senha">
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                placeholder="Sua senha"
              />
            </Field>
          </Form>
          <div className="login-security">
            <ShieldCheck size={16} />
            <p>Acesso protegido. Cada ação tem seu responsável.</p>
          </div>
        </div>
        <p className="login-help">
          <CircleHelp size={15} /> Precisa de acesso? Fale com a administração.
        </p>
      </section>
    </div>
  );
}
function Shell() {
  const {
    auth,
    data,
    connected,
    loading,
    error,
    notice,
    notify,
    reload,
    logout,
    pending,
  } = useStore();
  const [theme, setTheme] = useState(() => localStorage.getItem("mesa.theme") || "dark");
  const [menu, setMenu] = useState(false);
  const [recover, setRecover] = useState(false);
  const [signout, setSignout] = useState(false);
  const location = useLocation();
  const role = auth!.user.role;
  const nav = navigation.filter((item) => item.roles.includes(role));
  const current = nav.find((item) => location.pathname === item.to);
  const waiter = role === "waiter";
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("mesa.theme", theme);
  }, [theme]);
  useEffect(() => {
    setMenu(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => notify(""), 7000);
    return () => window.clearTimeout(id);
  }, [notice, notify]);
  return (
    <div className={`workspace ${waiter ? "waiter-workspace" : ""}`}>
      <aside className={`sidebar ${menu ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <Link className="brand" to={home(role)}>
            mesa<span>.</span>
          </Link>
          <button
            className="icon-button mobile-menu-close"
            aria-label="Fechar menu"
            onClick={() => setMenu(false)}
          >
            <X size={20} />
          </button>
          <small>GESTÃO COM HOSPITALIDADE</small>
        </div>
        <div className="restaurant-identity">
          <span>{data.settings.name.slice(0, 1)}</span>
          <div>
            <strong>{data.settings.name}</strong>
            <small>{statusLabel[role]}</small>
          </div>
        </div>
        <p className="nav-caption">PRINCIPAL</p>
        <nav aria-label="Navegação principal">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-item ${isActive ? "selected" : ""}`}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
              {item.to === "/pedidos" &&
                data.cancellations.some((request) => request.status === "pending") && (
                  <i className="nav-dot" />
                )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-service">
            <span className={`dot ${connected ? "available" : "unavailable"}`} />
            <div>
              <strong>
                {connected ? "Operação conectada" : "Reconectando ao servidor"}
              </strong>
              <small>Seu salão, em sintonia.</small>
            </div>
          </div>
          <button className="logout-button" onClick={() => setSignout(true)}>
            <LogOut size={18} /> Sair do sistema
          </button>
        </div>
      </aside>
      {menu && (
        <button
          className="sidebar-backdrop"
          aria-label="Fechar navegação"
          onClick={() => setMenu(false)}
        />
      )}
      <div className="main-column">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              aria-label="Abrir navegação"
              onClick={() => setMenu(true)}
            >
              <Menu size={22} />
            </button>
            <span className="breadcrumb">
              Restaurante <span>/</span>{" "}
              <strong>{current?.label || "Atendimento"}</strong>
            </span>
          </div>
          <div className="topbar-actions">
            <span className={`connection-indicator ${connected ? "online" : ""}`}>
              {connected ? <Wifi size={15} /> : <WifiOff size={15} />}
              <span>{connected ? "Ao vivo" : "Sem conexão"}</span>
            </span>
            <button
              className="icon-button"
              aria-label="Atualizar dados"
              disabled={loading}
              onClick={() => {
                void reload();
              }}
            >
              <RefreshCw size={17} className={loading ? "spin" : ""} />
            </button>
            <button
              className="icon-button"
              aria-label={theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <div className="user-identity">
              <div className="avatar">
                {auth!.user.name
                  .split(" ")
                  .map((word) => word.slice(0, 1))
                  .slice(0, 2)
                  .join("")}
              </div>
              <div>
                <strong>{auth!.user.name}</strong>
                <small>{statusLabel[role]}</small>
              </div>
            </div>
          </div>
        </header>
        <main className="page-content">
          {error && (
            <div role="alert" className="alert error">
              <AlertTriangle size={17} />
              <span>{error}</span>
              <button
                className="text-link"
                onClick={() => {
                  void reload();
                }}
              >
                Tentar novamente
              </button>
            </div>
          )}
          {!connected && !loading && (
            <p className="alert">
              Conexão em recuperação. Os rascunhos continuam salvos; confirme no servidor
              antes de repetir qualquer operação.
            </p>
          )}
          {pending.length > 0 && (
            <button className="pending-banner" onClick={() => setRecover(true)}>
              <AlertTriangle size={18} />
              <span>
                <strong>
                  {pending.length}{" "}
                  {pending.length === 1 ? "operação aguarda" : "operações aguardam"}{" "}
                  confirmação
                </strong>
                <small>Revise e retome com segurança, sem duplicar.</small>
              </span>
              <ArrowRight size={18} />
            </button>
          )}
          <InstallBanner />
          <Routes>
            <Route
              path="/painel"
              element={
                <Guard roles={management}>
                  <DashboardPage />
                </Guard>
              }
            />
            <Route
              path="/mesas"
              element={
                <Guard roles={["admin", "cashier", "waiter"]}>
                  <TablesPage />
                </Guard>
              }
            />
            <Route
              path="/pedidos"
              element={
                <Guard roles={["admin", "cashier", "waiter"]}>
                  <OrdersPage />
                </Guard>
              }
            />
            <Route
              path="/historico"
              element={
                <Guard roles={management}>
                  <HistoryPage />
                </Guard>
              }
            />
            <Route
              path="/cozinha"
              element={
                <Guard roles={["admin", "kitchen"]}>
                  <KitchenPage />
                </Guard>
              }
            />
            <Route
              path="/catalogo"
              element={
                <Guard roles={["admin"]}>
                  <CatalogPage />
                </Guard>
              }
            />
            <Route
              path="/usuarios"
              element={
                <Guard roles={["admin"]}>
                  <UsersPage />
                </Guard>
              }
            />
            <Route
              path="/auditoria"
              element={
                <Guard roles={["admin"]}>
                  <AuditPage />
                </Guard>
              }
            />
            <Route
              path="/configuracoes"
              element={
                <Guard roles={["admin"]}>
                  <SettingsPage />
                </Guard>
              }
            />
            <Route path="/impressora" element={<Navigate to="/cozinha" replace />} />
            <Route path="*" element={<Navigate to={home(role)} replace />} />
          </Routes>
          <footer className="page-footer">
            <span>
              mesa<span className="gold">.</span> <i>Hospitalidade em cada detalhe.</i>
            </span>
            <span>
              {new Date().toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "long",
                year: "numeric",
              })}
            </span>
          </footer>
        </main>
      </div>
      {waiter && (
        <nav className="bottom-nav" aria-label="Navegação do garçom">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to}>
              <item.icon size={22} />
              <span>{item.label === "Pedidos" ? "Meus pedidos" : item.label}</span>
            </NavLink>
          ))}
          <button onClick={() => setSignout(true)}>
            <LogOut size={21} />
            <span>Sair</span>
          </button>
        </nav>
      )}
      {notice && (
        <div role="status" className="toast">
          <ShieldCheck size={18} />
          {notice}
          <button
            className="icon-button"
            aria-label="Dispensar aviso"
            onClick={() => notify("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {recover && <Recovery onClose={() => setRecover(false)} />}
      {signout && (
        <Modal title="Sair do sistema?" onClose={() => setSignout(false)}>
          <Form
            label="Confirmar saída"
            onSubmit={async () => {
              await logout();
              setSignout(false);
            }}
          >
            <p className="muted">
              Os rascunhos e operações aguardando confirmação continuam vinculados ao seu
              usuário neste dispositivo.
            </p>
          </Form>
        </Modal>
      )}
    </div>
  );
}
function operationName(op: PendingOperation) {
  if (op.key.startsWith("order:")) return "Envio de pedido";
  if (op.key.startsWith("payment:")) return "Recebimento de pagamento";
  if (op.key.startsWith("open:")) return "Abertura de atendimento";
  if (op.key.startsWith("close:")) return "Encerramento de atendimento";
  if (op.key.startsWith("cancel:")) return "Cancelamento de itens";
  if (op.key.startsWith("refund:")) return "Estorno manual";
  return "Reimpressão de comanda";
}
function Recovery({ onClose }: { onClose: () => void }) {
  const { pending, retry } = useStore();
  return (
    <Modal title="Operações aguardando confirmação" onClose={onClose}>
      <p className="muted">
        Uma interrupção pode ocorrer depois de o servidor concluir a ação. Retome a
        operação original para consultar o resultado com segurança.
      </p>
      {pending.map((op) => (
        <div className="recovery-item" key={op.key}>
          <h3>{operationName(op)}</h3>
          <p className="small muted">Iniciada em {dateTime(op.createdAt)}</p>
          {typeof op.body.tableId === "number" && <p>Mesa {op.body.tableId}</p>}
          {typeof op.body.amountCents === "number" && (
            <p>Valor: {money(op.body.amountCents)}</p>
          )}
          {typeof op.body.notes === "string" && op.body.notes && <p>{op.body.notes}</p>}
          <Form
            label="Retomar operação original"
            onSubmit={async () => {
              await retry(op);
            }}
          >
            <p className="small muted">
              Os dados e o identificador originais serão preservados.
            </p>
          </Form>
        </div>
      ))}
      {!pending.length && <Empty>Todas as operações foram confirmadas.</Empty>}
    </Modal>
  );
}
interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
function InstallBanner() {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const handle = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", handle);
    return () => window.removeEventListener("beforeinstallprompt", handle);
  }, []);
  if (dismissed || !prompt) return null;
  return (
    <div className="install-banner">
      <Download size={20} />
      <span>Tenha a Mesa sempre à mão. Instale neste dispositivo.</span>
      <button
        className="button"
        onClick={() => {
          void prompt
            .prompt()
            .then(() => prompt.userChoice)
            .then(() => setDismissed(true));
        }}
      >
        Instalar
      </button>
      <button
        aria-label="Dispensar instalação"
        className="icon-button"
        onClick={() => setDismissed(true)}
      >
        <X size={16} />
      </button>
    </div>
  );
}
