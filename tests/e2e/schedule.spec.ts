import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("фильтры: тип, время суток, поиск, сортировка, пресет", async ({
  page,
}) => {
  await login(page, "client");

  await page.getByRole("button", { name: "Йога", exact: true }).click();
  const cards = page.getByRole("group");
  const n = await cards.count();
  for (let i = 0; i < n; i++) {
    await expect(cards.nth(i).getByText("Йога").first()).toBeVisible();
  }

  await page.getByRole("button", { name: "Вечер", exact: true }).click();
  await page.getByRole("button", { name: "Все", exact: true }).first().click();

  await page.getByLabel("Поиск").fill("zzz-нет-такого");
  await expect(page.getByText("Ничего не найдено")).toBeVisible();
  await page.getByRole("button", { name: "Сбросить фильтры" }).click();
  await expect(cards.first()).toBeVisible();

  await page.getByLabel("Сортировка").selectOption("seats");

  await page.getByRole("button", { name: "Сохранить фильтр" }).click();
  await page.getByRole("dialog").getByLabel("Название").fill("Е2Е пресет");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Сохранить" })
    .click();
  await expect(
    page.getByRole("button", { name: "Е2Е пресет" }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Е2Е пресет" }).first().click();
  await page.getByRole("button", { name: "Удалить фильтр Е2Е пресет" }).click();
  await expect(page.getByRole("button", { name: "Е2Е пресет" })).toHaveCount(0);
});

test("переключение дней перерисовывает список", async ({ page }) => {
  await login(page, "client");
  await page.getByRole("tab", { name: /Завтра/ }).click();
  await expect(page.getByRole("group").first()).toBeVisible();
});
