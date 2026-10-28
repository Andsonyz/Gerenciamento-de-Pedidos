import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApplication } from "../backend/dist/app.js";
const directory = await mkdtemp(join(tmpdir(), "restaurante-e2e-"));
const application = createApplication({
  dbPath: join(directory, "test.sqlite"),
  staticDir: resolve("frontend/dist"),
});
application.http.listen(3101, "0.0.0.0");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await application.close();
    await rm(directory, { recursive: true, force: true });
    process.exit(0);
  });
