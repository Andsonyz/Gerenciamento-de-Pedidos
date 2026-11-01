import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Bill } from "@restaurante/shared";
async function login(page: Page, username: string) {
  await page.goto("/");
  await page.getByLabel("Usuário", { exact: true }).fill(username);
  await page.getByLabel("Senha", { exact: true }).fill("E2E-only-password-123!");
  await page.getByRole("button", { name: "Entrar no restaurante" }).click();
  await expect(page.locator(".connection-indicator")).toContainText("Ao vivo");
}
async function api<T>(
  context: BrowserContext,
  path: string,
  body?: object,
  method = "POST",
): Promise<T> {
  const me = await context.request.get("/api/auth/me");
  const { csrfToken } = await me.json();
  const response = await context.request.fetch("/api" + path, {
    method,
    headers: { "X-CSRF-Token": csrfToken },
    data: body,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as T;
}
test("alertas coloridos sincronizam mesas, lateral e celular e sobrevivem à recarga", async ({
  browser,
}) => {
  const desk = await browser.newContext({
      baseURL: "http://127.0.0.1:3101",
      viewport: { width: 1440, height: 1000 },
    }),
    mobile = await browser.newContext({
      baseURL: "http://127.0.0.1:3101",
      viewport: { width: 320, height: 780 },
    });
  try {
    const page = await desk.newPage(),
      waiter = await mobile.newPage();
    await login(page, "admin");
    await login(waiter, "waiter");
    await page.goto("/mesas");
    await waiter.goto("/mesas");
    const opened = await api<Bill>(desk, "/tables/12/open", { requestId: randomUUID() });
    const card = waiter.locator(".table-card").filter({ hasText: "Mesa 12" });
    await expect(card.locator(".attention-badge")).toHaveText("!Aguardando garçom");
    await expect(
      page
        .getByRole("region", { name: "Resumo de notificações" })
        .locator(".attention-waiter"),
    ).toContainText("1");
    await page.goto("/avisos?type=waiter");
    await page
      .locator(".notification-card")
      .filter({ hasText: "Mesa 12" })
      .getByRole("button", { name: "Atender chamado" })
      .click();
    await expect(card.locator(".attention-badge")).toHaveText("!Aguardando pedido");
    const order = await api<{ id: string }>(desk, "/orders", {
      requestId: randomUUID(),
      tableId: 12,
      sessionId: opened.id,
      notes: "Teste de notificações",
      items: [{ productId: 1, quantity: 1 }],
    });
    for (const status of ["preparing", "ready", "delivered"])
      await api(desk, `/orders/${order.id}/status`, { status }, "PATCH");
    await expect(card.locator(".attention-badge")).toHaveCount(0);
    await card.click();
    await waiter
      .getByRole("dialog")
      .getByRole("button", { name: "Chamar garçom", exact: true })
      .click();
    await expect(
      page.locator(".notification-card").filter({ hasText: "Mesa 12" }),
    ).toContainText("Aguardando garçom");
    await page.reload();
    await expect(
      page.locator(".notification-card").filter({ hasText: "Mesa 12" }),
    ).toContainText("Aguardando garçom");
    await api(desk, `/sessions/${opened.id}/request-close`, {});
    await expect(card.locator(".attention-badge")).toHaveText("!Fechamento de conta");
    const other: Bill[] = [];
    for (const tableId of [10, 11])
      other.push(
        await api<Bill>(desk, `/tables/${tableId}/open`, { requestId: randomUUID() }),
      );
    await api(desk, "/tables/10/acknowledge-call", { requestId: randomUUID() });
    await page.goto("/avisos");
    await expect(
      page.locator(".notification-card.attention-waiter").filter({ hasText: "Mesa 11" }),
    ).toBeVisible();
    await expect(
      page.locator(".notification-card.attention-order").filter({ hasText: "Mesa 10" }),
    ).toBeVisible();
    await expect(
      page.locator(".notification-card.attention-closing").filter({ hasText: "Mesa 12" }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/notification-colors-desktop.png",
      fullPage: true,
    });
    expect(
      await waiter.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await waiter.screenshot({
      path: "test-results/notification-mesas-mobile.png",
      fullPage: true,
    });
    for (const bill of [opened, ...other])
      await api(desk, `/sessions/${bill.id}/close`, {
        requestId: randomUUID(),
        exceptional: true,
        reason: "Encerramento do teste de alertas",
      });
    await expect(card.locator(".attention-badge")).toHaveCount(0);
  } finally {
    await desk.close();
    await mobile.close();
  }
});
