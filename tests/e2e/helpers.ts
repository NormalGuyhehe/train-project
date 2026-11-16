import { expect, type Locator, type Page } from "@playwright/test";

export async function login(
  page: Page,
  role: "client" | "admin",
): Promise<void> {
  await page.goto("/#/auth");
  await page
    .getByRole("button", { name: role === "admin" ? "Админ" : "Клиент" })
    .click();
  if (role === "admin") {
    await expect(page.getByRole("heading", { name: "Обзор" })).toBeVisible({
      timeout: 15_000,
    });
  } else {
    await expect(
      page.locator(".top-app, .hero-fit, .days").first(),
    ).toBeVisible({ timeout: 15_000 });
  }
}

export const uniqueEmail = (): string => `e2e+${Date.now()}@atlet.kz`;

export function toast(page: Page, text: string): Locator {
  return page.getByRole("status").filter({ hasText: text });
}
