import { test, expect, type Page, type BrowserContext } from "@playwright/test";

const password = "E2E-only-password-123!";
async function login(page: Page, username: string) {
  await page.goto("/");
  await page.getByLabel("Usuário", { exact: true }).fill(username);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar no restaurante" }).click();
  await expect(page.locator(".connection-indicator")).toContainText("Ao vivo");
}
async function openComposer(page: Page, table = 1, open = true) {
  await page.goto("/mesas");
  await page
    .locator(".table-card")
    .filter({ hasText: `Mesa ${String(table).padStart(2, "0")}` })
    .click();
  if (open) {
    await page.getByRole("button", { name: "Abrir atendimento", exact: true }).click();
    await page.getByRole("button", { name: "Confirmar abertura" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
      .locator(".table-card")
      .filter({ hasText: `Mesa ${String(table).padStart(2, "0")}` })
      .click();
  }
  await page.getByRole("button", { name: "Adicionar pedido", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Novo pedido");
}
async function compose(page: Page, note: string, quantity = 1) {
  for (let n = 0; n < quantity; n++)
    await page
      .getByRole("button", { name: "Adicionar Hambúrguer da casa", exact: true })
      .click();
  await page.getByLabel("Observações para a cozinha").fill(note);
  await page.getByRole("button", { name: "Revisar e enviar" }).click();
}
async function api(
  context: BrowserContext,
  path: string,
  method = "GET",
  body?: unknown,
) {
  const me = await context.request.get("/api/auth/me");
  const { csrfToken } = await me.json();
  const response = await context.request.fetch("/api" + path, {
    method,
    data: body,
    headers: { "X-CSRF-Token": csrfToken },
  });
  return { status: response.status(), body: await response.json() };
}

test("fluxo real: garçom, desktop, cozinha offline, cancelamento parcial, caixa e fechamento", async ({
  browser,
}) => {
  const baseURL = "http://127.0.0.1:3101";
  const deskContext = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "block",
  });
  const waiterContext = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    serviceWorkers: "block",
  });
  const kitchenContext = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "block",
  });
  try {
    const desk = await deskContext.newPage(),
      waiter = await waiterContext.newPage(),
      kitchen = await kitchenContext.newPage();
    await login(desk, "admin");
    await login(waiter, "waiter");
    await login(kitchen, "kitchen");
    await kitchen.goto("/impressora");
    await expect(kitchen).toHaveURL(/\/cozinha$/);
    await kitchen.getByRole("button", { name: "Simular desconexão" }).click();
    await expect(
      kitchen.getByText("Impressora virtual desconectada", { exact: true }),
    ).toBeVisible();
    const note = "Fluxo integrado sem cebola";
    await openComposer(waiter);
    await compose(waiter, note, 3);
    await waiter.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
    await expect(waiter.getByRole("dialog")).toHaveCount(0);
    await desk.goto("/pedidos");
    const order = desk.locator(".order-card").filter({ hasText: note });
    await expect(order).toHaveCount(1);
    await expect(order).toContainText("3 ×");
    await expect(kitchen.locator(".kitchen-card").filter({ hasText: note })).toHaveCount(
      0,
    );
    await kitchen.getByRole("button", { name: "Reconectar e recuperar fila" }).click();
    const receipt = kitchen.locator(".kitchen-card").filter({ hasText: note });
    await expect(receipt).toHaveCount(1);
    await expect(receipt).not.toContainText("R$");
    await expect(receipt).toContainText("Exibido");
    await waiter.goto("/pedidos");
    await waiter
      .locator(".order-card")
      .filter({ hasText: note })
      .getByRole("button", { name: "Solicitar cancelamento" })
      .click();
    await waiter.getByLabel(/Hambúrguer da casa · disponível/).fill("1");
    await waiter
      .getByLabel("Justificativa", { exact: true })
      .fill("Cliente reduziu o consumo");
    await waiter.getByRole("button", { name: "Enviar solicitação" }).click();
    await expect(
      desk.locator(".request-row").filter({ hasText: "Cliente reduziu o consumo" }),
    ).toBeVisible();
    await desk.getByRole("button", { name: "Analisar", exact: true }).click();
    await desk.getByLabel("Justificativa", { exact: true }).fill("Redução aprovada");
    await desk.getByRole("checkbox").check();
    await desk.getByRole("button", { name: "Registrar decisão" }).click();
    await expect(order).toContainText("2 ×");
    await expect(
      kitchen.locator(".cancellation-card").filter({ hasText: note }),
    ).toHaveCount(1);
    await desk.goto("/mesas");
    await desk.locator(".table-card").filter({ hasText: "Mesa 01" }).click();
    await desk.getByRole("button", { name: "Ver conta e receber" }).click();
    const bill = desk.getByRole("dialog");
    await expect(bill.locator(".total")).toContainText("56,00");
    await bill.getByRole("button", { name: "Receber pagamento", exact: true }).click();
    await bill.getByLabel("Forma de pagamento").selectOption("cash");
    await bill.getByLabel(/Valor a pagar/).fill("20,00");
    await bill.getByLabel(/Valor recebido em dinheiro/).fill("50,00");
    await bill.getByRole("button", { name: "Revisar pagamento" }).click();
    await expect(bill.locator(".confirm-box")).toContainText("30,00");
    await bill.getByRole("button", { name: "Confirmar recebimento" }).click();
    await expect(bill.locator(".balance")).toContainText("36,00");
    await bill.getByRole("button", { name: "Receber pagamento", exact: true }).click();
    await bill.getByRole("button", { name: "Revisar pagamento" }).click();
    await bill.getByRole("button", { name: "Confirmar recebimento" }).click();
    await expect(bill.locator(".balance")).toContainText("0,00");
    await bill.getByRole("button", { name: "Encerrar conta", exact: true }).click();
    await bill.getByRole("button", { name: "Confirmar encerramento" }).click();
    await expect(bill).toContainText("Encerrada");
    await desk.screenshot({
      path: "test-results/premium-conta-desktop.png",
      fullPage: true,
    });
    await kitchen.reload();
    await expect(kitchen.locator(".kitchen-card").filter({ hasText: note })).toHaveCount(
      2,
    );
    const rows = (await api(deskContext, "/sessions")).body;
    expect(rows.find((s: { tableId: number }) => s.tableId === 1)).toMatchObject({
      status: "closed",
      totalCents: 5600,
      paidCents: 5600,
      balanceCents: 0,
    });
    await kitchen.screenshot({
      path: "test-results/premium-cozinha.png",
      fullPage: true,
    });
  } finally {
    await Promise.all([
      deskContext.close(),
      waiterContext.close(),
      kitchenContext.close(),
    ]);
  }
});

test("resposta perdida conserva envio e recuperação após reload não duplica", async ({
  page,
  context,
}) => {
  await login(page, "waiter");
  await openComposer(page, 2);
  const note = "Envio com resposta perdida";
  await compose(page, note);
  let intercepted = false;
  await page.route("**/api/orders", async (route) => {
    if (route.request().method() === "POST" && !intercepted) {
      intercepted = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "conectar" })).toBeVisible();
  await page.reload();
  await expect(page.locator(".pending-banner")).toContainText(
    "1 operação aguarda confirmação",
  );
  await page.locator(".pending-banner").click();
  await page.getByRole("button", { name: "Retomar operação original" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Todas as operações foram confirmadas.",
  );
  expect(
    (await api(context, "/orders")).body.filter(
      (o: { notes: string }) => o.notes === note,
    ),
  ).toHaveLength(1);
});

test("dois cliques rápidos não repetem pedido; rascunho sobrevive à recarga", async ({
  page,
  context,
}) => {
  await login(page, "waiter");
  await openComposer(page, 3);
  await compose(page, "Proteção contra cliques repetidos", 2);
  await page.reload();
  await openComposer(page, 3, false);
  await expect(page.getByLabel("Observações para a cozinha")).toHaveValue(
    "Proteção contra cliques repetidos",
  );
  await page.getByRole("button", { name: "Revisar e enviar" }).click();
  await page
    .getByRole("button", { name: "Confirmar pedido", exact: true })
    .evaluate((button) => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    (await api(context, "/orders")).body.filter(
      (o: { notes: string }) => o.notes === "Proteção contra cliques repetidos",
    ),
  ).toHaveLength(1);
});

test("duas abas mantêm envios incertos independentes e retomam as duas intenções", async ({
  page,
  context,
}) => {
  await login(page, "waiter");
  const second = await context.newPage();
  await second.goto("/mesas");
  await openComposer(page, 4);
  await openComposer(second, 5);
  const notes = ["Intenção da primeira aba", "Intenção da segunda aba"];
  for (const [index, current] of [page, second].entries()) {
    await compose(current, notes[index]!);
    await current.route("**/api/orders", async (route) => {
      if (route.request().method() === "POST") {
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await current.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
    await expect(
      current.getByRole("alert").filter({ hasText: "conectar" }),
    ).toBeVisible();
  }
  await page.unroute("**/api/orders");
  await second.unroute("**/api/orders");
  await page.reload();
  await expect(page.locator(".pending-banner")).toContainText(
    "2 operações aguardam confirmação",
  );
  await page.locator(".pending-banner").click();
  await page.getByRole("button", { name: "Retomar operação original" }).first().click();
  await expect(page.locator(".recovery-item")).toHaveCount(1);
  await page.getByRole("button", { name: "Retomar operação original" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Todas as operações foram confirmadas.",
  );
  const orders = (await api(context, "/orders")).body;
  for (const note of notes)
    expect(orders.filter((o: { notes: string }) => o.notes === note)).toHaveLength(1);
});

test("permissões, tema claro, responsividade e recursos locais", async ({
  page,
  context,
}) => {
  const errors: string[] = [],
    external: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (req) => {
    if (!new URL(req.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/))
      external.push(req.url());
  });
  await page.setViewportSize({ width: 320, height: 760 });
  await login(page, "waiter");
  await expect(
    page.getByRole("navigation").filter({ hasText: "Meus pedidos" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    )
    .toBe(true);
  await page.goto("/usuarios");
  await expect(page).toHaveURL(/\/mesas$/);
  expect((await context.request.get("/api/users")).status()).toBe(403);
  await page.getByRole("button", { name: "Ativar tema claro" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({ path: "test-results/premium-garcom-320.png", fullPage: true });
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
  const manifest = await context.request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  expect((await manifest.json()).display).toBe("standalone");
});

test("administra catálogo, disponibilidade e usuários com persistência e auditoria", async ({
  page,
  context,
}) => {
  await login(page, "admin");
  await page.goto("/catalogo");
  await page.getByRole("button", { name: "Nova categoria", exact: true }).click();
  await page.getByLabel("Nome da categoria").fill("Seleção do chef");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Salvar", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Adicionar produto", exact: true }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Sobremesa especial de teste");
  await page
    .getByLabel("Categoria", { exact: true })
    .selectOption({ label: "Seleção do chef" });
  await page.getByLabel("Preço (R$)", { exact: true }).fill("35,90");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Salvar", exact: true })
    .click();
  const row = page.getByRole("row").filter({ hasText: "Sobremesa especial de teste" });
  await expect(row).toContainText("35,90");
  await row.getByRole("button", { name: "Editar", exact: true }).click();
  await page.getByLabel("Disponível para novos pedidos").uncheck();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Salvar", exact: true })
    .click();
  await expect(row).toContainText("Indisponível");
  await page.goto("/usuarios");
  await page.getByRole("button", { name: "Adicionar usuário" }).click();
  await page.getByLabel("Nome completo").fill("Garçom adicional");
  await page.getByLabel("Nome de usuário").fill("extra.waiter");
  await page.getByLabel("Senha inicial").fill("New-test-password-123!");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Salvar", exact: true })
    .click();
  await expect(page.getByRole("row").filter({ hasText: "extra.waiter" })).toContainText(
    "Garçom",
  );
  const products = (await api(context, "/products")).body;
  expect(
    products.find((p: { name: string }) => p.name === "Sobremesa especial de teste"),
  ).toMatchObject({ priceCents: 3590, available: false });
  expect(
    (await api(context, "/audit")).body.some(
      (a: { action: string }) => a.action === "product.saved",
    ),
  ).toBe(true);
  await page.goto("/painel");
  await page.screenshot({ path: "test-results/premium-dashboard.png", fullPage: true });
});

test("PWA conserva recursos locais e não armazena respostas da API", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.getByLabel("Usuário", { exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await page.request.get("/api/health");
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const urls: string[] = [];
    for (const name of names) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) urls.push(new URL(request.url).pathname);
    }
    return urls;
  });
  expect(cached).toContain("/");
  expect(cached.every((path) => !path.startsWith("/api"))).toBe(true);
});
