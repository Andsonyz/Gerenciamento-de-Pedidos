import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type {
  Ingredient,
  Purchase,
  SimulationState,
  PremiumOrder,
  CatalogProduct,
} from "@restaurante/shared";

const operationalPassword = "E2E-only-password-123!";
async function login(page: Page, training = false, username = "admin") {
  await page.goto(training ? "/simulacao/" : "/");
  await page.getByLabel("Usuário", { exact: true }).fill(username);
  await page
    .getByLabel("Senha", { exact: true })
    .fill(training ? "123" : operationalPassword);
  await page.getByRole("button", { name: "Entrar no restaurante" }).click();
  await expect(page.locator(".connection-indicator")).toContainText("Ao vivo");
}
async function request<T>(
  context: BrowserContext,
  path: string,
  options: { training?: boolean; method?: string; body?: unknown } = {},
): Promise<T> {
  const prefix = options.training ? "/simulacao/api" : "/api";
  const session = await context.request.get(`${prefix}/auth/me`);
  expect(session.ok()).toBeTruthy();
  const { csrfToken } = (await session.json()) as { csrfToken: string };
  const response = await context.request.fetch(prefix + path, {
    method: options.method || "GET",
    data: options.body,
    headers: { "X-CSRF-Token": csrfToken },
  });
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return (await response.json()) as T;
}

test("ingredientes, ficha versionada, recebimento parcial e indicadores usam registros persistidos", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  await login(page);
  const ingredientName = "Farinha de teste integrado";
  await page.goto("/estoque");
  await page.getByRole("button", { name: "Ingrediente", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome do ingrediente").fill(ingredientName);
  await dialog.getByLabel("Unidade", { exact: true }).selectOption("kg");
  await dialog.getByLabel("Estoque mínimo").fill("0,2");
  await dialog.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  let ingredient = (await request<Ingredient[]>(context, "/inventory")).find(
    (i) => i.name === ingredientName,
  )!;
  expect(ingredient).toMatchObject({ unit: "g", minimum: 200, physical: 0 });
  await page.getByRole("button", { name: "Movimentar", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Ingrediente", { exact: true }).selectOption(ingredient.id);
  await dialog.getByLabel("Quantidade", { exact: true }).fill("1");
  await dialog.getByLabel("Unidade da quantidade").selectOption("kg");
  await dialog
    .getByLabel("Justificativa", { exact: true })
    .fill("Inventário inicial conferido no teste");
  await dialog.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const product = await request<CatalogProduct>(context, "/products", {
    method: "POST",
    body: {
      name: "Massa exclusiva do teste de estoque",
      category: "Pratos",
      priceCents: 2500,
      active: true,
      available: true,
    },
  });
  await page.reload();
  await page.getByRole("button", { name: "Fichas técnicas", exact: true }).click();
  await page.getByLabel("Produto da ficha técnica").selectOption(String(product.id));
  await page.getByRole("button", { name: "Nova versão" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Adicionar ingrediente" }).click();
  await dialog.getByLabel("Ingrediente 1", { exact: true }).selectOption(ingredient.id);
  await dialog.getByLabel("Unidade", { exact: true }).selectOption("kg");
  await dialog.getByLabel("Quantidade por produto").fill("0,2001");
  await dialog.getByRole("button", { name: "Publicar versão" }).click();
  await expect(dialog.getByRole("alert")).toContainText("inteiras");
  await dialog.getByLabel("Quantidade por produto").fill("0,2");
  await dialog.getByRole("button", { name: "Publicar versão" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".ops-history")).toContainText("200 g");

  await page.goto("/compras");
  await page.getByRole("button", { name: "Fornecedor", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome do fornecedor").fill("Fornecedor integrado de teste");
  await dialog.getByLabel(ingredientName, { exact: true }).check();
  await dialog.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Nova compra", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Fornecedor da compra")
    .selectOption({ label: "Fornecedor integrado de teste" });
  await dialog.getByRole("button", { name: "Adicionar item", exact: true }).click();
  await dialog.getByLabel("Ingrediente da compra 1").selectOption(ingredient.id);
  await dialog.getByLabel("Quantidade comprada").fill("10");
  await dialog.getByLabel("Valor total deste item (R$)").fill("10,00");
  await dialog.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(dialog).toHaveCount(0);
  const row = page.getByRole("row").filter({ hasText: "Fornecedor integrado de teste" });
  await row.getByRole("button", { name: "Detalhes", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirmar compra", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirmar compra", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Confirmado");
  await page.getByRole("button", { name: "Registrar recebimento", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel(/Farinha de teste integrado.*restante 10/).fill("6");
  const receiptRequest = page.waitForRequest(
    (req) => /\/purchases\/[^/]+\/receive$/.test(req.url()) && req.method() === "POST",
  );
  await dialog.getByRole("button", { name: "Confirmar entrada no estoque" }).click();
  const sent = await receiptRequest;
  await expect(page.getByRole("dialog")).toContainText("Recebido parcialmente");
  const purchaseId = sent.url().split("/").at(-2)!;
  const purchase = await request<Purchase>(context, `/purchases/${purchaseId}`);
  expect(purchase.items[0]).toMatchObject({
    quantity: 10,
    receivedQuantity: 6,
    receivedCents: 600,
  });
  await request(context, `/purchases/${purchaseId}/receive`, {
    method: "POST",
    body: sent.postDataJSON(),
  });
  ingredient = (await request<Ingredient[]>(context, "/inventory")).find(
    (i) => i.id === ingredient.id,
  )!;
  expect(ingredient.physical).toBe(1006);
  await page.getByRole("button", { name: "Cancelar saldo", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Motivo do cancelamento")
    .fill("Restante indisponível no fornecedor");
  await page.getByRole("button", { name: "Confirmar cancelamento", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Saldo cancelado");
  await page.goto("/indicadores");
  await expect(
    page.getByRole("heading", { name: "Indicadores e reposição" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Consumo e estoque", exact: true }).click();
  await expect(
    page.getByRole("row").filter({ hasText: ingredientName }).last(),
  ).toContainText("1.006 g");
  await page.screenshot({
    path: "test-results/evolution-inventory-analytics.png",
    fullPage: true,
  });
});

async function resetSimulation(page: Page, context: BrowserContext) {
  await request(context, "/simulation/control", {
    training: true,
    method: "POST",
    body: { action: "reset" },
  });
  await page.goto("/simulacao/simulador");
  await expect(
    page.getByRole("heading", { name: "Restaurante em movimento" }),
  ).toBeVisible();
}
async function startScenario(page: Page, mode: "automatic" | "interactive") {
  await page.getByRole("button", { name: "Configurar e iniciar" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Modo de atendimento").selectOption(mode);
  await dialog.getByLabel("Velocidade inicial").selectOption("5");
  await dialog.getByLabel("Intervalo de chegadas (s)").fill("1");
  await dialog.getByLabel("Tempo de preparo (s)").fill("1");
  await dialog.getByLabel("Tempo de consumo (s)").fill("1");
  await dialog.getByLabel("Limite de grupos").fill("1");
  await dialog.getByRole("button", { name: "Iniciar simulação" }).click();
  await expect(dialog).toHaveCount(0);
}

test("simulação automática conclui atendimento sem alterar banco ou sessão operacional", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  await login(page);
  const before = await request<PremiumOrder[]>(context, "/orders");
  const stockBefore = await request<Ingredient[]>(context, "/inventory");
  const operationalSession = await request<{ user: { id: string } }>(context, "/auth/me");
  const simulation = await context.newPage();
  await login(simulation, true);
  await resetSimulation(simulation, context);
  await startScenario(simulation, "automatic");
  await expect
    .poll(
      async () =>
        (await request<SimulationState>(context, "/simulation", { training: true }))
          .metrics.completed,
      { timeout: 25000 },
    )
    .toBe(1);
  const jobs = await request<unknown[]>(context, "/print-jobs", { training: true });
  expect(jobs.length).toBeGreaterThan(0);
  const after = await request<PremiumOrder[]>(context, "/orders");
  expect(after.map((i) => i.id)).toEqual(before.map((i) => i.id));
  expect(await request<Ingredient[]>(context, "/inventory")).toEqual(stockBefore);
  expect((await request<{ user: { id: string } }>(context, "/auth/me")).user.id).toBe(
    operationalSession.user.id,
  );
  await simulation.getByRole("button", { name: "Lista acessível" }).click();
  await simulation.screenshot({
    path: "test-results/evolution-simulation-automatic.png",
    fullPage: true,
  });
  await simulation.close();
});

test("garçom assume intenção, revisa pedido e acompanha ciclo interativo no celular", async ({
  browser,
  page,
  context,
}) => {
  test.setTimeout(60000);
  await login(page, true);
  await resetSimulation(page, context);
  await startScenario(page, "interactive");
  await expect
    .poll(
      async () =>
        (
          await request<SimulationState>(context, "/simulation", { training: true })
        ).groups.some((g) => g.status === "requesting"),
      { timeout: 15000 },
    )
    .toBeTruthy();
  const waiterContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3101",
    viewport: { width: 390, height: 844 },
    serviceWorkers: "block",
  });
  try {
    const waiter = await waiterContext.newPage();
    await login(waiter, true, "garcom");
    await waiter.goto("/simulacao/simulador");
    await waiter.getByRole("button", { name: "Atender mesa", exact: true }).click();
    const dialog = waiter.getByRole("dialog");
    await expect(dialog).toContainText("Atender mesa");
    await dialog.getByLabel("Quantidade solicitada", { exact: true }).first().fill("2");
    await dialog
      .getByLabel("Observações para cozinha")
      .fill("Treinamento interativo confirmado pelo garçom");
    await dialog.getByRole("button", { name: "Confirmar pedido dos clientes" }).click();
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await request<SimulationState>(context, "/simulation", { training: true }))
            .metrics.completed,
        { timeout: 25000 },
      )
      .toBe(1);
    const orders = await request<PremiumOrder[]>(context, "/orders", { training: true });
    expect(orders).toHaveLength(1);
    expect(orders[0]?.items[0]?.quantity).toBe(2);
    expect(orders[0]?.notes).toContain("Treinamento interativo");
    expect(
      await waiter.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
    const denied = await waiterContext.request.post("/simulacao/api/simulation/control", {
      data: { action: "reset", requestId: randomUUID() },
    });
    expect([401, 403]).toContain(denied.status());
    await waiter.screenshot({
      path: "test-results/evolution-simulation-waiter-mobile.png",
      fullPage: true,
    });
  } finally {
    await waiterContext.close();
  }
});
