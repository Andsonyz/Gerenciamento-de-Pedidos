import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { io } from "socket.io-client";
import type {
  AuditEntry,
  AuthSession,
  Bill,
  CancellationRequest,
  CatalogProduct,
  Category,
  Dashboard,
  DiningTable,
  PremiumOrder,
  PrintJob,
  RestaurantSettings,
  User,
} from "@restaurante/shared";
import { api, ApiError, setCsrfToken } from "./api";
import {
  getOperation,
  readOperations,
  saveOperation,
  completeOperation,
  type PendingOperation,
} from "./operations";
export type { PendingOperation } from "./operations";
interface Data {
  tables: DiningTable[];
  products: CatalogProduct[];
  categories: Category[];
  orders: PremiumOrder[];
  cancellations: CancellationRequest[];
  sessions: Bill[];
  printJobs: PrintJob[];
  users: User[];
  audit: AuditEntry[];
  dashboard: Dashboard | null;
  settings: RestaurantSettings;
}
const initial: Data = {
  tables: [],
  products: [],
  categories: [],
  orders: [],
  cancellations: [],
  sessions: [],
  printJobs: [],
  users: [],
  audit: [],
  dashboard: null,
  settings: { name: "Restaurante", otherPaymentEnabled: false },
};
interface Context {
  auth: AuthSession | null;
  initializing: boolean;
  data: Data;
  loading: boolean;
  connected: boolean;
  realtimePaused: boolean;
  setRealtimePaused: (paused: boolean) => void;
  error: string;
  notice: string;
  pending: PendingOperation[];
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  reload: (force?: boolean) => Promise<void>;
  mutate: <T>(
    path: string,
    body: Record<string, unknown>,
    method?: string,
    key?: string,
    original?: PendingOperation,
  ) => Promise<T>;
  retry: (operation: PendingOperation) => Promise<void>;
  notify: (message: string) => void;
}
const Store = createContext<Context | null>(null);
export function useStore() {
  const store = useContext(Store);
  if (!store) throw new Error("Sessão indisponível");
  return store;
}
export function StoreProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthSession | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [data, setData] = useState<Data>(initial);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [realtimePaused, setRealtimePaused] = useState(false);
  const [error, setError] = useState("");
  const [operationsError, setOperationsError] = useState("");
  const [notice, notify] = useState("");
  const [pending, setPending] = useState<PendingOperation[]>([]);
  const running = useRef(new Set<string>());
  const reloadVersion = useRef(0);
  const currentUserId = useRef<string | null>(null);
  const pauseRealtime = useCallback((paused: boolean) => {
    ++reloadVersion.current;
    setRealtimePaused(paused);
    setLoading(false);
  }, []);
  const accept = useCallback((session: AuthSession) => {
    if (currentUserId.current !== session.user.id) {
      ++reloadVersion.current;
      setData(initial);
      setError("");
      setPending([]);
    }
    currentUserId.current = session.user.id;
    setCsrfToken(session.csrfToken);
    setAuth(session);
    try {
      setPending(readOperations(session.user.id));
      setOperationsError("");
    } catch (cause) {
      setOperationsError(
        cause instanceof Error ? cause.message : "Falha ao ler operações pendentes.",
      );
    }
  }, []);
  useEffect(() => {
    void api<AuthSession>("/auth/me")
      .then(accept)
      .catch(() => {})
      .finally(() => setInitializing(false));
  }, [accept]);
  const reload = useCallback(
    async (force = false) => {
      if (!auth || (realtimePaused && !force)) return;
      const version = ++reloadVersion.current;
      setLoading(true);
      const role = auth.user.role;
      const entries: [keyof Data, string][] = [
        ["tables", "/tables"],
        ["settings", "/settings"],
      ];
      if (role !== "kitchen")
        entries.push(
          ["products", "/products"],
          ["categories", "/categories"],
          ["orders", "/orders"],
          ["cancellations", "/cancellation-requests"],
        );
      if (role === "admin" || role === "cashier")
        entries.push(["sessions", "/sessions"], ["dashboard", "/dashboard"]);
      if (role === "admin") entries.push(["users", "/users"], ["audit", "/audit"]);
      if (role === "admin" || role === "kitchen")
        entries.push(["printJobs", "/print-jobs"]);
      const results = await Promise.allSettled(
        entries.map(async ([key, path]) => [key, await api<unknown>(path)] as const),
      );
      if (version !== reloadVersion.current) return;
      const next: Partial<Data> = {};
      let message = "";
      for (const result of results) {
        if (result.status === "fulfilled")
          Object.assign(next, { [result.value[0]]: result.value[1] });
        else {
          message =
            result.reason instanceof Error ? result.reason.message : "Falha ao atualizar";
          if (result.reason instanceof ApiError && result.reason.status === 401) {
            setAuth(null);
            currentUserId.current = null;
            setData(initial);
            setPending([]);
            setCsrfToken("");
            setLoading(false);
            return;
          }
        }
      }
      setData((previous) => ({ ...previous, ...next }));
      setError(message);
      setLoading(false);
    },
    [auth, realtimePaused],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    if (!auth || realtimePaused) {
      setConnected(false);
      return;
    }
    const socket = io({
      withCredentials: true,
      auth: { csrfToken: auth.csrfToken },
    });
    socket.on("connect", () => {
      setConnected(true);
      void reload();
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => {
      setConnected(false);
      void reload();
    });
    socket.on("state:changed", () => {
      void reload();
    });
    const refresh = () => {
      void reload();
    };
    window.addEventListener("online", refresh);
    return () => {
      socket.disconnect();
      window.removeEventListener("online", refresh);
    };
  }, [auth, reload, realtimePaused]);
  useEffect(() => {
    if (!auth) return;
    const sync = () => {
      try {
        setPending(readOperations(auth.user.id));
      } catch (cause) {
        setOperationsError(
          cause instanceof Error ? cause.message : "Falha no armazenamento de operações.",
        );
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [auth]);
  const mutate = useCallback(
    async <T,>(
      path: string,
      body: Record<string, unknown>,
      method = "POST",
      key?: string,
      original?: PendingOperation,
    ): Promise<T> => {
      if (!auth) throw new Error("Entre novamente para continuar.");
      const operationKey = key || `${method}:${path}`;
      if (running.current.has(operationKey))
        throw new Error("Esta operação já está em andamento.");
      running.current.add(operationKey);
      let operation: PendingOperation | undefined;
      try {
        if (key) {
          operation = original || getOperation(auth.user.id, key, path, method, body);
          saveOperation(auth.user.id, operation);
          setPending(readOperations(auth.user.id));
        }
        const result = await api<T>(operation?.path || path, {
          method: operation?.method || method,
          body: JSON.stringify(operation?.body || body),
        });
        if (operation) {
          completeOperation(auth.user.id, operation);
          setPending(readOperations(auth.user.id));
          if (operation.path === "/orders" && typeof operation.body.tableId === "number")
            localStorage.removeItem(
              `mesa.draft.v3.${auth.user.id}.${operation.body.tableId}.${String(operation.body.sessionId)}.${operation.tabId}`,
            );
        }
        await reload();
        return result;
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 401) {
          setAuth(null);
          currentUserId.current = null;
          ++reloadVersion.current;
          setData(initial);
          setPending([]);
          setCsrfToken("");
        }
        if (
          operation &&
          cause instanceof ApiError &&
          ([400, 403, 404, 413, 422].includes(cause.status) ||
            (cause.status === 409 && cause.code === "BUSINESS_CONFLICT"))
        ) {
          completeOperation(auth.user.id, operation);
          setPending(readOperations(auth.user.id));
        }
        throw new Error(
          cause instanceof Error
            ? cause.message
            : "Não foi possível concluir. Verifique a conexão e tente novamente.",
        );
      } finally {
        running.current.delete(operationKey);
      }
    },
    [auth, reload],
  );
  return (
    <Store.Provider
      value={{
        auth,
        initializing,
        data,
        loading,
        connected,
        realtimePaused,
        setRealtimePaused: pauseRealtime,
        error: operationsError || error,
        notice,
        pending,
        notify,
        reload,
        mutate,
        retry: async (op) => {
          await mutate(op.path, op.body, op.method, op.key, op);
          notify("Operação recuperada com sucesso.");
        },
        login: async (username, password) => {
          accept(
            await api<AuthSession>("/auth/login", {
              method: "POST",
              body: JSON.stringify({ username, password }),
            }),
          );
        },
        logout: async () => {
          await api("/auth/logout", { method: "POST", body: "{}" });
          setAuth(null);
          currentUserId.current = null;
          ++reloadVersion.current;
          setData(initial);
          setPending([]);
          setRealtimePaused(false);
          setCsrfToken("");
        },
      }}
    >
      {children}
    </Store.Provider>
  );
}
