import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApplication } from "../backend/dist/app.js";
const directory = await mkdtemp(join(tmpdir(), "restaurante-e2e-"));
const application = createApplication({
  dbPath: join(directory, "test.sqlite"),
  staticDir: resolve("frontend/dist"),
  bootstrapAdmin: {
    username: "admin",
    name: "Administrador",
    password: "E2E-only-password-123!",
  },
});
const { AuthService } = await import("../backend/dist/modules/auth.js");
const { Store } = await import("../backend/dist/database/store.js");
const seed = new Store(join(directory, "test.sqlite"));
const auth = new AuthService(seed);
for (const role of ["waiter", "cashier", "kitchen"])
  auth.saveUser(null, {
    username: role,
    name: role,
    role,
    active: true,
    password: "E2E-only-password-123!",
  });
seed.close();
application.http.listen(3101, "0.0.0.0");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await application.close();
    await rm(directory, { recursive: true, force: true });
    process.exit(0);
  });
