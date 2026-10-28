import { test, expect } from "@playwright/test";

test("garçom móvel envia comanda; impressora recupera, deduplica e mantém visualizada", async ({
  page,
  context,
}) => {
  const printer = await context.newPage();
  await printer.goto("/impressora");
  await expect(printer.getByText("Conectada", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Mesa 03", exact: true }).click();
  await page
    .getByRole("button", { name: "Adicionar Hambúrguer da casa", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Aumentar Hambúrguer da casa", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Adicionar Água mineral", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remover Água mineral", exact: true })
    .click();
  const note = `Sem cebola ${Date.now()}`;
  await page.getByLabel("Observações do pedido").fill(note);
  await page.getByRole("button", { name: "Confirmar pedido" }).click();
  await expect(page.getByRole("status")).toContainText("confirmado");
  const receipt = printer.getByRole("article").filter({ hasText: note });
  await expect(receipt).toHaveCount(1);
  await expect(receipt).toContainText("Mesa 03");
  await expect(receipt).toContainText("2 ×");
  await expect(receipt).not.toContainText("Água mineral");
  await receipt
    .getByRole("button", { name: "Marcar como visualizada" })
    .click();
  await expect(receipt.getByText("Visualizada", { exact: true })).toBeVisible();
  await printer.reload();
  await printer
    .getByRole("button", { name: "Visualizadas", exact: true })
    .click();
  await expect(receipt).toHaveCount(1);
  await printer.getByRole("button", { name: "Todas", exact: true }).click();
  await printer
    .getByRole("button", { name: "Simular falha de conexão" })
    .click();
  await expect(
    printer.getByText("Conexão pausada", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Adicionar Batata frita", exact: true })
    .click();
  const offlineNote = `Durante falha ${Date.now()}`;
  await page.getByLabel("Observações do pedido").fill(offlineNote);
  await page.getByRole("button", { name: "Confirmar pedido" }).click();
  await expect(page.getByRole("status")).toContainText("confirmado");
  await expect(
    printer.getByRole("article").filter({ hasText: offlineNote }),
  ).toHaveCount(0);
  await printer.getByRole("button", { name: "Reconectar impressora" }).click();
  await expect(
    printer.getByRole("article").filter({ hasText: offlineNote }),
  ).toHaveCount(1);
  await printer
    .getByRole("button", { name: "Simular falha de conexão" })
    .click();
  await printer.getByRole("button", { name: "Reconectar impressora" }).click();
  await expect(printer.getByText("Conectada", { exact: true })).toBeVisible();
  await expect(
    printer.getByRole("article").filter({ hasText: offlineNote }),
  ).toHaveCount(1);
  await printer.close();
  await page
    .getByRole("button", { name: "Adicionar Água mineral", exact: true })
    .click();
  const closedNote = `Página fechada ${Date.now()}`;
  await page.getByLabel("Observações do pedido").fill(closedNote);
  await page.getByRole("button", { name: "Confirmar pedido" }).click();
  await expect(page.getByRole("status")).toContainText("confirmado");
  const reopened = await context.newPage();
  await reopened.goto("/impressora");
  await expect(
    reopened.getByRole("article").filter({ hasText: closedNote }),
  ).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("resposta perdida mantém chave após recarregar e repetir sem duplicação", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Mesa 01", exact: true }).click();
  await page
    .getByRole("button", { name: "Adicionar Hambúrguer da casa", exact: true })
    .click();
  const note = `Resposta perdida ${Date.now()}`;
  await page.getByLabel("Observações do pedido").fill(note);
  await page.route("**/api/orders", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const saved = await route.fetch();
    expect(saved.status()).toBe(201);
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Confirmar pedido" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Não foi possível confirmar",
  );
  await page.unroute("**/api/orders");
  await page.reload();
  await expect(page.getByLabel("Observações do pedido")).toHaveValue(note);
  await expect(page.getByLabel("Observações do pedido")).toBeDisabled();
  await page.getByRole("button", { name: "Tentar envio novamente" }).click();
  await expect(page.getByRole("status")).toContainText("confirmado");
  const orders = (await (await request.get("/api/orders")).json()) as {
    notes: string;
  }[];
  expect(orders.filter((order) => order.notes === note)).toHaveLength(1);
});

test("uma segunda aba não apaga o envio incerto da primeira", async ({
  page,
  context,
  request,
}) => {
  await page.goto("/");
  const other = await context.newPage();
  await other.goto("/"); // Both tabs are open before either submission starts.
  const note = `Duas abas ${Date.now()}`;
  await page.getByRole("button", { name: "Mesa 01", exact: true }).click();
  await page
    .getByRole("button", { name: "Adicionar Hambúrguer da casa", exact: true })
    .click();
  await page.getByLabel("Observações do pedido").fill(note);
  await page.route("**/api/orders", async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Confirmar pedido" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Não foi possível confirmar",
  );
  await other.getByRole("button", { name: "Mesa 02", exact: true }).click();
  await other
    .getByRole("button", { name: "Adicionar Água mineral", exact: true })
    .click();
  await other.getByRole("button", { name: "Confirmar pedido" }).click();
  await expect(other.getByRole("status")).toContainText("confirmado");
  await page.unroute("**/api/orders");
  await page.reload();
  await expect(page.getByLabel("Observações do pedido")).toHaveValue(note);
  await page.getByRole("button", { name: "Tentar envio novamente" }).click();
  await expect(page.getByRole("status")).toContainText("confirmado");
  const orders = (await (await request.get("/api/orders")).json()) as {
    notes: string;
  }[];
  expect(orders.filter((order) => order.notes === note)).toHaveLength(1);
});

test("clique repetido durante envio cria apenas um pedido", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Mesa 04", exact: true }).click();
  await page
    .getByRole("button", { name: "Adicionar Batata frita", exact: true })
    .click();
  const note = `Clique duplo ${Date.now()}`;
  await page.getByLabel("Observações do pedido").fill(note);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let sent = 0;
  await page.route("**/api/orders", async (route) => {
    sent++;
    await gate;
    await route.continue();
  });
  const button = page.getByRole("button", { name: "Confirmar pedido" });
  await button.evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
  await expect.poll(() => sent).toBe(1);
  await expect(
    page.getByRole("button", { name: "Enviando pedido…" }),
  ).toBeDisabled();
  release();
  await expect(page.getByRole("status")).toContainText("confirmado");
  const orders = (await (await request.get("/api/orders")).json()) as {
    notes: string;
  }[];
  expect(orders.filter((order) => order.notes === note)).toHaveLength(1);
});

test("telas cabem em 320px e carregam apenas recursos locais", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).hostname !== "127.0.0.1")
      external.push(request.url());
  });
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto("/");
  await expect(
    page.getByRole("button", {
      name: "Adicionar Hambúrguer da casa",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("garcom-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 760 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("garcom-mobile.png"),
    fullPage: true,
  });
  await page.goto("/impressora");
  await expect(page.getByText("Conectada", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("impressora-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.screenshot({
    path: testInfo.outputPath("impressora-desktop.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
