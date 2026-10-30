import { Router } from "express";
import { actor, allow, AuthService, cookieToken } from "./modules/auth.js";
import { Restaurant } from "./modules/restaurant.js";
import { Finance } from "./modules/finance.js";
import { Cancellations } from "./modules/cancellations.js";
import * as s from "./modules/schemas.js";
import type { StateChange } from "@restaurante/shared";

export function routes(
  auth: AuthService,
  r: Restaurant,
  notify: (scope: StateChange["scope"], id: string, owner?: string | null) => void,
) {
  const router = Router(),
    finance = new Finance(r),
    cancels = new Cancellations(r);
  const office = allow("admin", "cashier"),
    service = allow("admin", "cashier", "waiter"),
    admin = allow("admin"),
    kitchen = allow("admin", "kitchen");
  router.post("/auth/login", (req, res) => {
    const input = s.parse(s.login, req.body),
      result = auth.login(input.username, input.password, req.ip ?? "unknown");
    res.cookie("restaurant_session", result.token, {
      httpOnly: true,
      sameSite: "strict",
      secure: req.secure,
      path: "/",
      maxAge: 12 * 60 * 60_000,
    });
    res.json(result.session);
  });
  router.use(auth.middleware);
  router.get("/auth/me", (_req, res) => res.json(res.locals.auth));
  router.post("/auth/logout", (req, res) => {
    auth.logout(cookieToken(req.headers.cookie));
    res.clearCookie("restaurant_session", {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: req.secure,
    });
    notify("settings", "session");
    res.json({ ok: true });
  });
  router.get("/tables", (_req, res) => res.json(r.tables()));
  router.post("/tables/:id/open", service, (req, res) => {
    const result = r.open(
      actor(res),
      s.numericId(req.params.id),
      s.parse(s.request, req.body).requestId,
    );
    notify("tables", String(req.params.id));
    const b = result.value;
    res
      .status(result.created ? 201 : 200)
      .json(
        actor(res).role === "waiter"
          ? { id: b.id, tableId: b.tableId, status: b.status }
          : b,
      );
  });
  router.patch("/tables/:id", office, (req, res) => {
    const value = r.tableStatus(
      actor(res),
      s.numericId(req.params.id),
      s.parse(s.tableStatus, req.body).status,
    );
    notify("tables", String(value.id));
    res.json(value);
  });
  router.get("/sessions", office, (_req, res) => res.json(r.bills()));
  router.get("/sessions/:id", office, (req, res) =>
    res.json(r.bill(s.parse(s.id, req.params.id))),
  );
  router.post("/sessions/:id/request-close", service, (req, res) => {
    const bill = r.requestClose(actor(res), s.parse(s.id, req.params.id));
    notify("tables", String(bill.tableId));
    res.json(
      actor(res).role === "waiter"
        ? { id: bill.id, tableId: bill.tableId, status: bill.status }
        : bill,
    );
  });
  router.patch("/sessions/:id/adjustments", admin, (req, res) => {
    const bill = finance.adjustments(
      actor(res),
      s.parse(s.id, req.params.id),
      s.parse(s.adjustments, req.body),
    );
    notify("payments", bill.id);
    res.json(bill);
  });
  router.post("/sessions/:id/payments", office, (req, res) => {
    const result = finance.pay(
      actor(res),
      s.parse(s.id, req.params.id),
      s.parse(s.payment, req.body),
    );
    notify("payments", result.value.id);
    notify("tables", String(result.value.tableId));
    res.status(result.created ? 201 : 200).json(result.value);
  });
  router.post("/sessions/:id/close", office, (req, res) => {
    const result = finance.close(
      actor(res),
      s.parse(s.id, req.params.id),
      s.parse(s.close, req.body),
    );
    notify("tables", String(result.value.tableId));
    res.json(result.value);
  });
  router.post("/payments/:id/refund", admin, (req, res) => {
    const result = finance.refund(
      actor(res),
      s.parse(s.id, req.params.id),
      s.parse(s.refund, req.body),
    );
    notify("payments", result.value.id);
    res.json(result.value);
  });
  router.get("/products", service, (_req, res) =>
    res.json(r.products(actor(res).role === "admin")),
  );
  router.post("/products", admin, (req, res) => {
    const product = r.saveProduct(actor(res), s.parse(s.product, req.body));
    notify("catalog", String(product.id));
    res.status(201).json(product);
  });
  router.patch("/products/:id", admin, (req, res) => {
    const product = r.saveProduct(
      actor(res),
      s.parse(s.product, req.body),
      s.numericId(req.params.id),
    );
    notify("catalog", String(product.id));
    res.json(product);
  });
  router.get("/categories", service, (_req, res) => res.json(r.categories()));
  router.post("/categories", admin, (req, res) => {
    const c = r.category(actor(res), s.parse(s.category, req.body).name);
    notify("catalog", String(c.id));
    res.status(201).json(c);
  });
  router.get("/orders", service, (_req, res) => res.json(r.listOrders(actor(res))));
  router.get("/orders/:id", service, (req, res) => {
    const o = r.order(s.parse(s.id, req.params.id));
    r.assertOwner(actor(res), o);
    res.json(o);
  });
  router.post("/orders", service, (req, res) => {
    const result = r.createOrder(actor(res), s.parse(s.newOrder, req.body));
    notify("orders", result.value.id, result.value.userId);
    notify("printing", result.value.id);
    res.status(result.created ? 201 : 200).json(result.value);
  });
  router.patch("/orders/:id/status", allow("admin", "cashier", "kitchen"), (req, res) => {
    const o = r.orderStatus(
      actor(res),
      s.parse(s.id, req.params.id),
      s.parse(s.orderStatus, req.body).status,
    );
    notify("orders", o.id, o.userId);
    notify("printing", o.id);
    res.json(actor(res).role === "kitchen" ? { id: o.id, status: o.status } : o);
  });
  router.get("/cancellation-requests", service, (_req, res) =>
    res.json(cancels.list(actor(res))),
  );
  router.post("/orders/:id/cancellation-requests", service, (req, res) => {
    const result = cancels.request(
      actor(res),
      s.parse(s.id, req.params.id),
      s.parse(s.cancellation, req.body),
    );
    notify("cancellations", result.value.id, result.value.userId);
    res.status(result.created ? 201 : 200).json(result.value);
  });
  router.post("/orders/:id/cancel", office, (req, res) => {
    const result = cancels.cancel(
      actor(res),
      s.parse(s.id, req.params.id),
      s.parse(s.cancellation, req.body),
    );
    notify("orders", result.value.id, result.value.userId);
    notify("printing", result.value.id);
    res.json(result.value);
  });
  router.post("/cancellation-requests/:id/resolve", office, (req, res) => {
    const c = cancels.resolve(
      actor(res),
      s.parse(s.id, req.params.id),
      s.parse(s.resolution, req.body),
    );
    notify("cancellations", c.id, c.userId);
    notify("printing", c.orderId);
    res.json(c);
  });
  router.get("/print-jobs", kitchen, (_req, res) => res.json(r.printer.list()));
  router.patch("/print-jobs/:id", kitchen, (req, res) => {
    const job = r.printer.update(
      actor(res),
      s.parse(s.id, req.params.id),
      s.parse(s.printStatus, req.body).status,
    );
    notify("printing", job.id);
    res.json(job);
  });
  router.post("/print-jobs/:id/reprint", kitchen, (req, res) => {
    const result = r.printer.reprint(
      actor(res),
      s.parse(s.id, req.params.id),
      s.parse(s.reprint, req.body),
    );
    notify("printing", result.value.id);
    res.status(result.created ? 201 : 200).json(result.value);
  });
  router.get("/dashboard", office, (_req, res) => {
    const d = r.dashboard();
    if (actor(res).role !== "admin")
      d.recent = d.recent.filter(
        (x) => !x.action.startsWith("user.") && !x.action.startsWith("auth."),
      );
    res.json(d);
  });
  router.get("/audit", admin, (_req, res) => res.json(r.audit()));
  router.get("/users", admin, (_req, res) => res.json(auth.users()));
  router.post("/users", admin, (req, res) => {
    const u = auth.saveUser(actor(res).id, s.parse(s.user, req.body));
    notify("settings", u.id);
    res.status(201).json(u);
  });
  router.patch("/users/:id", admin, (req, res) => {
    const u = auth.saveUser(
      actor(res).id,
      s.parse(s.user, req.body),
      s.parse(s.id, req.params.id),
    );
    notify("settings", u.id);
    res.json(u);
  });
  router.get("/settings", (_req, res) => res.json(r.settings()));
  router.patch("/settings", admin, (req, res) => {
    const settings = r.saveSettings(actor(res), s.parse(s.settings, req.body));
    notify("settings", "restaurant");
    res.json(settings);
  });
  return router;
}
