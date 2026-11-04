import express from "express";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import cors from "cors";
import { Server } from "socket.io";
import { join } from "node:path";
import type { ErrorRequestHandler } from "express";
import type { StateChange, AuthSession } from "@restaurante/shared";
import { Store } from "./database/store.js";
import { AuthService, cookieToken } from "./modules/auth.js";
import { Restaurant } from "./modules/restaurant.js";
import { VirtualPrinterAdapter } from "./printing/VirtualPrinterAdapter.js";
import { HttpError } from "./errors.js";
import { originAllowed } from "./origins.js";
import { privateAddress } from "./network.js";
import { routes } from "./routes.js";
import { Simulation } from "./modules/simulation.js";
import { seedSimulation } from "./modules/simulation-seed.js";
import { seedSimulationInventory } from "./modules/demo-inventory.js";
import { assertSeparateDatabases } from "./database/identity.js";
import { DashboardConnector, type ConnectorConfig } from "./integration/connector.js";
import { TrainingResources } from "./modules/training-resources.js";

export function createApplication(options: {
  dbPath: string;
  simulationDbPath?: string;
  staticDir?: string;
  allowedOrigins?: string[];
  allowedSubnets?: string[];
  tls?: { key: Buffer; cert: Buffer };
  bootstrapAdmin?: { username: string; password: string; name: string };
  dashboardSync?: ConnectorConfig;
}) {
  if (options.simulationDbPath)
    assertSeparateDatabases(options.dbPath, options.simulationDbPath);
  const app = express();
  // Validate configuration before accepting requests; a bad CIDR must not crash a socket callback.
  privateAddress("192.168.0.1", options.allowedSubnets);
  app.disable("x-powered-by");
  const http = options.tls ? createHttpsServer(options.tls, app) : createServer(app);
  const db = new Store(options.dbPath),
    auth = new AuthService(db);
  if (options.bootstrapAdmin) auth.bootstrap(options.bootstrapAdmin);
  const origin: cors.CorsOptions["origin"] = (value, cb) =>
    cb(
      originAllowed(value, options.allowedOrigins)
        ? null
        : new HttpError(403, "Origem não permitida."),
      true,
    );
  const io = new Server(http, {
    cors: { origin, credentials: true },
    allowRequest: (req, cb) =>
      cb(
        null,
        originAllowed(req.headers.origin, options.allowedOrigins) &&
          privateAddress(req.socket.remoteAddress, options.allowedSubnets),
      ),
  });
  io.use((socket, next) => {
    try {
      const session = auth.session(cookieToken(socket.request.headers.cookie));
      if (socket.handshake.auth.csrfToken !== session.csrfToken)
        throw new Error("Sessão inválida.");
      socket.data.auth = session;
      next();
    } catch {
      next(new Error("Autenticação necessária."));
    }
  });
  io.on("connection", (socket) => {
    const session = socket.data.auth as AuthSession;
    void socket.join(`role:${session.user.role}`);
    void socket.join(`user:${session.user.id}`);
    socket.emit("state:changed", {
      id: "connection",
      scope: "tables",
    } satisfies StateChange);
  });
  const validateSockets = () => {
    for (const socket of io.sockets.sockets.values()) {
      try {
        auth.session(cookieToken(socket.request.headers.cookie));
      } catch {
        socket.disconnect(true);
      }
    }
  };
  const timer = setInterval(validateSockets, 30_000);
  timer.unref();
  const notify = (scope: StateChange["scope"], id: string, owner?: string | null) => {
    validateSockets();
    const event = { scope, id } satisfies StateChange;
    io.to("role:admin").to("role:cashier").emit("state:changed", event);
    if (
      scope === "printing" ||
      scope === "tables" ||
      (scope === "settings" && id === "restaurant")
    )
      io.to("role:kitchen").emit("state:changed", event);
    if (
      ["tables", "catalog"].includes(scope) ||
      (scope === "settings" && id === "restaurant")
    )
      io.to("role:waiter").emit("state:changed", event);
    else if (owner)
      io.to(`user:${owner}`)
        .except("role:admin")
        .except("role:cashier")
        .emit("state:changed", event);
  };
  const printer = new VirtualPrinterAdapter(db, (job) => notify("printing", job.id)),
    restaurant = new Restaurant(db, printer);
  let training:
    | { db: Store; engine: Simulation; auth: AuthService; restaurant: Restaurant }
    | undefined;
  let dashboardConnector: DashboardConnector | undefined;
  if (options.simulationDbPath) {
    const trainingDb = new Store(options.simulationDbPath);
    seedSimulation(trainingDb);
    seedSimulationInventory(trainingDb);
    new TrainingResources(trainingDb);
    if (options.dashboardSync)
      dashboardConnector = new DashboardConnector(
        trainingDb,
        options.dashboardSync,
      ).start();
    const trainingAuth = new AuthService(trainingDb, "restaurant_training_session");
    const namespace = io.of("/simulacao");
    namespace.use((socket, next) => {
      try {
        const session = trainingAuth.session(
          cookieToken(socket.request.headers.cookie, trainingAuth.cookieName),
        );
        if (socket.handshake.auth.csrfToken !== session.csrfToken)
          throw new Error("Sessão inválida.");
        socket.data.auth = session;
        next();
      } catch {
        next(new Error("Autenticação necessária."));
      }
    });
    namespace.on("connection", (socket) => {
      const session = socket.data.auth as AuthSession;
      void socket.join(`role:${session.user.role}`);
      void socket.join(`user:${session.user.id}`);
      socket.emit("state:changed", { id: "connection", scope: "tables" });
    });
    const trainingNotify = (
      scope: StateChange["scope"],
      id: string,
      owner?: string | null,
    ) => {
      for (const socket of namespace.sockets.values()) {
        try {
          trainingAuth.session(
            cookieToken(socket.request.headers.cookie, trainingAuth.cookieName),
          );
        } catch {
          socket.disconnect(true);
        }
      }
      namespace.to("role:admin").to("role:cashier").emit("state:changed", { scope, id });
      if (["printing", "tables", "settings"].includes(scope))
        namespace.to("role:kitchen").emit("state:changed", { scope, id });
      if (["tables", "catalog", "settings"].includes(scope))
        namespace.to("role:waiter").emit("state:changed", { scope, id });
      else if (owner) namespace.to(`user:${owner}`).emit("state:changed", { scope, id });
    };
    const trainingRestaurant = new Restaurant(
      trainingDb,
      new VirtualPrinterAdapter(trainingDb),
    );
    const engine = new Simulation(trainingRestaurant, () =>
      trainingNotify("tables", "simulation"),
    );
    engine.begin();
    training = {
      db: trainingDb,
      engine,
      auth: trainingAuth,
      restaurant: trainingRestaurant,
    };
    // Mounted after shared security middleware below.
    app.locals.trainingRoutes = routes(
      trainingAuth,
      trainingRestaurant,
      trainingNotify,
      engine,
    );
  }
  app.use((req, res, next) => {
    if (!privateAddress(req.socket.remoteAddress, options.allowedSubnets))
      return next(
        new HttpError(403, "Acesso permitido somente pela rede privada autorizada."),
      );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    next();
  });
  app.use(cors({ origin, credentials: true }));
  app.use(express.json({ limit: "32kb" }));
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  if (training) {
    app.use("/simulacao/api", (_req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      next();
    });
    app.use("/simulacao/api", app.locals.trainingRoutes);
    app.use("/simulacao/api", (_req, res) =>
      res.status(404).json({ error: "Recurso não encontrado." }),
    );
  }
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/api", routes(auth, restaurant, notify));
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Recurso não encontrado." }),
  );
  if (options.staticDir) {
    app.get("/simulacao/sw.js", (_req, res) =>
      res.sendFile(join(options.staticDir!, "sw.js")),
    );
    app.use(express.static(options.staticDir, { dotfiles: "deny" }));
    app.get("/{*path}", (_req, res) =>
      res.sendFile(join(options.staticDir!, "index.html")),
    );
  }
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (
      error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "ZodError"
    ) {
      res.status(400).json({ error: "Dados inválidos. Confira os campos e limites." });
      return;
    }
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    if (error && typeof error === "object" && "type" in error) {
      if (error.type === "entity.parse.failed") {
        res.status(400).json({ error: "JSON inválido." });
        return;
      }
      if (error.type === "entity.too.large") {
        res.status(413).json({ error: "Requisição excede o limite de tamanho." });
        return;
      }
    }
    console.error(error);
    res
      .status(500)
      .json({ error: "Não foi possível concluir a operação. Tente novamente." });
  };
  app.use(errors);
  let closed = false;
  return {
    app,
    http,
    training,
    close: async () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      training?.engine.close();
      await dashboardConnector?.close();
      await new Promise<void>((resolve) => {
        io.close(() => resolve());
        http.closeIdleConnections();
      });
      db.close();
      training?.db.close();
    },
  };
}
