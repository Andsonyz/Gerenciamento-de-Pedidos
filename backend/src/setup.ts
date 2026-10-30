import { createInterface } from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";
import { stdin, stdout } from "node:process";
import { Store } from "./database/store.js";
import { AuthService } from "./modules/auth.js";
import { dbPath } from "./config.js";
import { parse, user as userSchema } from "./modules/schemas.js";

async function hiddenPassword(): Promise<string> {
  if (!stdin.isTTY)
    throw new Error("Defina ADMIN_PASSWORD ou execute em um terminal interativo.");
  stdout.write("Senha do administrador (mínimo 12 caracteres): ");
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let password = "";
    const cleanup = () => {
      stdin.off("keypress", handler);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
    };
    const handler = (text: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("Configuração cancelada."));
      } else if (key.name === "return") {
        cleanup();
        resolve(password);
      } else if (key.name === "backspace") password = password.slice(0, -1);
      else if (text && !key.ctrl) password += text;
    };
    stdin.on("keypress", handler);
  });
}
const db = new Store(dbPath);
try {
  const auth = new AuthService(db);
  if (auth.users().length)
    console.log(
      "Instalação já configurada. Gerencie os usuários no painel administrativo.",
    );
  else {
    let username = process.env.ADMIN_USERNAME,
      name = process.env.ADMIN_NAME;
    if (!username) {
      const prompt = createInterface({ input: stdin, output: stdout });
      username = await prompt.question("Identificação do administrador: ");
      name = await prompt.question("Nome: ");
      prompt.close();
    }
    const password = process.env.ADMIN_PASSWORD ?? (await hiddenPassword());
    const input = parse(userSchema, {
      username,
      name: name || "Administrador",
      password,
      role: "admin",
      active: true,
    });
    auth.bootstrap({ username: input.username, name: input.name, password });
    console.log(
      "Administrador criado. Inicie o sistema e cadastre os funcionários no painel.",
    );
  }
} finally {
  db.close();
}
