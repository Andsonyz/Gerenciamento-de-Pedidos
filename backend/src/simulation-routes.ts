import { Router } from "express";
import { z } from "zod";
import { Simulation } from "./modules/simulation.js";
import { actor, allow } from "./modules/auth.js";
import { id, parse } from "./modules/schemas.js";
export function simulationRoutes(engine: Simulation) {
  const router = Router();
  router.get("/simulation", (_req, res) => res.json(engine.state(actor(res))));
  router.post("/simulation/start", allow("admin"), (req, res) =>
    res.json(engine.start(actor(res), req.body)),
  );
  router.post("/simulation/control", allow("admin"), (req, res) =>
    res.json(engine.control(actor(res), req.body)),
  );
  router.post("/simulation/groups/:id/claim", allow("admin", "waiter"), (req, res) =>
    res.json(engine.intent(actor(res), parse(id, req.params.id))),
  );
  router.post("/simulation/groups/:id/serve", allow("admin", "waiter"), (req, res) =>
    res.json(
      engine.serve(
        actor(res),
        parse(id, req.params.id),
        parse(
          z
            .object({
              requestId: id.optional(),
              notes: z.string().max(500).optional(),
              items: z
                .array(
                  z
                    .object({
                      productId: z.number().int().min(1),
                      quantity: z.number().int().min(1).max(99),
                    })
                    .strict(),
                )
                .min(1)
                .max(50)
                .optional(),
            })
            .strict(),
          req.body,
        ),
      ),
    ),
  );
  return router;
}
