import { expect, test } from "@playwright/test";

test("гость видит лендинг и воронку до регистрации", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Сила/ })).toBeVisible();
  await expect(
    page.locator(".promo-bar").getByText("Первая тренировка — бесплатно"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Смотреть цены" }).click();
  await expect(page.locator("#pricing")).toBeInViewport();

  await page
    .getByRole("button", { name: "Записаться бесплатно" })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Регистрация" }),
  ).toBeVisible();

  await page.getByLabel("Имя и фамилия").fill("Тест Тестов");
  await page
    .getByLabel("Email", { exact: true })
    .fill(`e2e+${Date.now()}@atlet.kz`);
  await page.getByLabel("Пароль", { exact: true }).fill("secret1");
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(page.getByRole("navigation")).toBeVisible();
});

test("якоря лендинга скроллят секции", async ({ page }) => {
  await page.goto("/");
  for (const name of ["Направления", "Тренеры", "Цены"]) {
    await page.locator(".nav-link", { hasText: name }).click();
    await page.waitForTimeout(700);
  }
  const target = page.locator("#trainers");
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeInViewport();
});
