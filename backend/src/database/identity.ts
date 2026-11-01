import { existsSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
export function assertSeparateDatabases(operational: string, training: string) {
  if (operational === ":memory:" || training === ":memory:") return;
  const canonical = (path: string) => {
    const value = existsSync(path) ? realpathSync(path) : resolve(path);
    return process.platform === "win32" ? value.toLowerCase() : value;
  };
  let same = canonical(operational) === canonical(training);
  if (existsSync(operational) && existsSync(training)) {
    const a = statSync(operational),
      b = statSync(training);
    same ||= a.ino !== 0 && a.dev === b.dev && a.ino === b.ino;
  }
  if (same)
    throw new Error(
      "Os bancos operacional e de simulação devem usar arquivos físicos diferentes.",
    );
}
