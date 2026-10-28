import express from "express";
import { createServer } from "node:http";
import cors from "cors";
import { Server } from "socket.io";
import { join } from "node:path";
import type { ErrorRequestHandler } from "express";
import type { ClientEvents, ServerEvents } from "@restaurante/shared";
import { OrderDatabase } from "./database.js";
import { VirtualPrinterAdapter } from "./printing/VirtualPrinterAdapter.js";
import { OrderService } from "./orders.js";
import { orderSchema } from "./validation.js";
import { HttpError } from "./errors.js";
import { originAllowed } from "./origins.js";

export function createApplication(options: {
  dbPath: string;
  staticDir?: string;
  allowedOrigins?: string[];
}) {
  const app = express();
  app.disable("x-powered-by");
  const http = createServer(app);
  const database = new OrderDatabase(options.dbPath);
  const origin: cors.CorsOptions["origin"] = (value, callback) =>
    callback(
      originAllowed(value, options.allowedOrigins)
        ? null
        : new HttpError(403, "Origem não permitida."),
      true,
    );
  const io = new Server<ClientEvents, ServerEvents>(http, {
    cors: { origin },
    allowRequest: (request, callback) =>
      callback(
        null,
        originAllowed(request.headers.origin, options.allowedOrigins),
      ),
  });
  const printer = new VirtualPrinterAdapter(io, () => database.list());
  const orders = new OrderService(database, printer);
  app.use(cors({ origin }));
  app.use(express.json({ limit: "32kb" }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/tables", (_req, res) => res.json(database.tables()));
  app.get("/api/products", (_req, res) => res.json(database.products()));
  app.get("/api/orders", (_req, res) => res.json(database.list()));
  app.get("/api/orders/:id", (req, res) =>
    res.json(database.get(req.params.id)),
  );
  app.post("/api/orders", (req, res) => {
    const parsed = orderSchema.safeParse(req.body);
    if (!parsed.success)
      throw new HttpError(
        400,
        "Pedido inválido. Confira mesa, produtos, quantidades (1–99) e observações (até 500 caracteres).",
      );
    const result = orders.create(parsed.data);
    res.status(result.created ? 201 : 200).json(result.order);
  });
  app.patch("/api/orders/:id/viewed", (req, res) =>
    res.json(orders.markViewed(req.params.id)),
  );
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Recurso não encontrado." }),
  );
  if (options.staticDir) {
    app.use(express.static(options.staticDir));
    app.get(["/", "/impressora"], (_req, res) =>
      res.sendFile(join(options.staticDir!, "index.html")),
    );
  }
  const errorHandler: ErrorRequestHandler = (
    error: unknown,
    _req,
    res,
    _next,
  ) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error && typeof error === "object" && "type" in error) {
      if (error.type === "entity.parse.failed") {
        res.status(400).json({ error: "JSON inválido." });
        return;
      }
      if (error.type === "entity.too.large") {
        res.status(413).json({ error: "Pedido excede o limite de tamanho." });
        return;
      }
    }
    console.error(error);
    res
      .status(500)
      .json({
        error: "Não foi possível concluir a operação. Tente novamente.",
      });
  };
  app.use(errorHandler);
  let closed = false;
  return {
    app,
    http,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve) => {
        io.close(() => resolve());
        http.closeIdleConnections();
      });
      database.close();
    },
  };
}
