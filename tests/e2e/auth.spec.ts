import { expect, test } from "@playwright/test";
import { login, toast, uniqueEmail } from "./helpers";

test("неверный пароль отклоняется с тостом", async ({ page }) => {
  await page.goto("/#/auth");
  await page.getByLabel("Email", { exact: true }).fill("client@atlet.kz");
  await page.getByLabel("Пароль", { exact: true }).fill("wrong");
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(toast(page, "Неверный email или пароль")).toBeVisible();
});

test("регистрация и выход", async ({ page }) => {
  await page.goto("/#/auth");
  await page.getByRole("tab", { name: "Регистрация" }).click();
  await page.getByLabel("Имя и фамилия").fill("Е2Е Юзер");
  await page.getByLabel("Email", { exact: true }).fill(uniqueEmail());
  await page.getByLabel("Пароль", { exact: true }).fill("secret1");
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(page.getByRole("navigation")).toBeVisible();

  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(page.getByRole("heading", { name: /Сила/ })).toBeVisible();
});

test("демо-вход клиента ведёт в расписание", async ({ page }) => {
  await login(page, "client");
  await expect(page.getByRole("heading", { name: /Привет/ })).toBeVisible();
});
