import { Router } from "express";
import { z } from "zod";
import type { StateChange } from "@restaurante/shared";
import { actor, allow } from "./modules/auth.js";
import {
  TrainingResources,
  contributionInput,
  cashInput,
} from "./modules/training-resources.js";
import type { Restaurant } from "./modules/restaurant.js";
export function trainingResourcesRoutes(
  r: Restaurant,
  notify: (scope: StateChange["scope"], id: string) => void,
) {
  const router = Router(),
    resources = new TrainingResources(r.db),
    admin = allow("admin"),
    office = allow("admin", "cashier");
  router.get("/resources", office, (_req, res) => res.json(resources.state()));
  router.get("/dashboard-sync", office, (_req, res) => {
    const enabled = !!r.db.get(
      "SELECT name FROM sqlite_master WHERE name='dashboard_sync_meta'",
    );
    res.json(
      enabled
        ? {
            enabled,
            ...r.db.get(
              "SELECT source_id AS sourceId,dataset_id AS datasetId,sequence,ack AS ackSequence,last_error AS lastError FROM dashboard_sync_meta WHERE id=1",
            ),
            pending: r.db.get<{ n: number }>(
              "SELECT COUNT(*) n FROM dashboard_sync_outbox",
            )!.n,
          }
        : { enabled: false },
    );
  });
  router.post("/resources/sponsors", admin, (req, res) => {
    const v = resources.saveSponsor(
      actor(res),
      z.strictObject({ name: z.string() }).parse(req.body),
    );
    notify("catalog", v.id);
    res.status(201).json(v);
  });
  router.post("/resources/contributions", admin, (req, res) => {
    const v = resources.receive(actor(res), contributionInput.parse(req.body));
    notify("catalog", v.id);
    notify("payments", v.id);
    res.status(201).json(v);
  });
  router.post("/resources/contributions/:id/reverse", admin, (req, res) => {
    const v = z.strictObject({ requestId: z.uuid(), reason: z.string() }).parse(req.body);
    res.json(
      resources.reverseContribution(
        actor(res),
        String(req.params.id),
        v.requestId,
        v.reason,
      ),
    );
    notify("catalog", String(req.params.id));
    notify("payments", String(req.params.id));
  });
  router.post("/resources/opening", admin, (req, res) => {
    res.json(
      resources.setOpeningBalance(
        actor(res),
        z
          .strictObject({
            requestId: z.uuid(),
            amountCents: z.number(),
            reason: z.string(),
          })
          .parse(req.body),
      ),
    );
    notify("payments", "opening");
  });
  router.post("/resources/entries", admin, (req, res) => {
    res.status(201).json(resources.entry(actor(res), cashInput.parse(req.body)));
    notify("payments", "entry");
  });
  router.post("/resources/entries/:id/reverse", admin, (req, res) => {
    const v = z.strictObject({ requestId: z.uuid(), reason: z.string() }).parse(req.body);
    res.json(
      resources.reverseEntry(actor(res), String(req.params.id), v.requestId, v.reason),
    );
    notify("payments", String(req.params.id));
  });
  return router;
}
