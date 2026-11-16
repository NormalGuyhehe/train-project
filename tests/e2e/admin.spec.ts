import { expect, test } from "@playwright/test";
import { login, toast } from "./helpers";

test("обзор и навигация админа", async ({ page }) => {
  await login(page, "admin");
  await expect(page.getByRole("heading", { name: "Обзор" })).toBeVisible();
  for (const name of ["Расписание", "Клиенты", "Отчёты", "Обзор"]) {
    await page.getByRole("button", { name, exact: true }).first().click();
  }
});

test("CRUD тренировки с undo", async ({ page }) => {
  await login(page, "admin");
  await page
    .getByRole("button", { name: "Расписание", exact: true })
    .first()
    .click();

  await page.getByRole("button", { name: "Новая тренировка" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Название").fill("Е2Е тренировка");
  await dlg.getByLabel("Тренер").fill("Тестовый тренер");
  await dlg.getByLabel("Зал").fill("Зал 1");
  await dlg.getByLabel("Длительность, мин").fill("60");
  await dlg.getByLabel("Вместимость").fill("10");
  await dlg.getByLabel("Дата").fill("2030-05-05");
  await dlg.getByLabel("Время").fill("10:00");
  await dlg.getByRole("button", { name: "Сохранить" }).click();
  await expect(toast(page, "Тренировка добавлена").first()).toBeVisible({
    timeout: 10_000,
  });

  await expect(page.getByText("Е2Е тренировка").first()).toBeVisible();

  const row = page.locator("tr", { hasText: "Е2Е тренировка" });
  await row.getByRole("button", { name: "Редактировать" }).click();
  await page.getByRole("dialog").getByLabel("Вместимость").fill("7");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Сохранить" })
    .click();
  await expect(toast(page, "Тренировка обновлена")).toBeVisible();

  await row.getByRole("button", { name: "Удалить" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Удалить", exact: true })
    .click();
  await expect(toast(page, "удалена")).toBeVisible();
  await toast(page, "удалена").getByRole("button", { name: "Вернуть" }).click();
  await expect(toast(page, "восстановлена")).toBeVisible();

  await page
    .locator("tr", { hasText: "Е2Е тренировка" })
    .getByRole("button", { name: "Удалить" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Удалить", exact: true })
    .click();
});

test("ростер: confirm поверх drawer не закрывает drawer", async ({ page }) => {
  await login(page, "admin");
  await page
    .getByRole("button", { name: "Расписание", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Состав группы" }).first().click();
  const drawer = page.getByRole("dialog").last();
  await expect(drawer).toBeVisible();
  const cancelBtn = drawer
    .getByRole("button", { name: "Отменить запись клиента" })
    .first();
  if (await cancelBtn.count()) {
    await cancelBtn.click();
    await expect(page.getByRole("dialog")).toHaveCount(2);
    await page
      .getByRole("dialog")
      .last()
      .getByRole("button", { name: "Отмена" })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(1);
  }
  await page.keyboard.press("Escape");
});

test("клиенты: поиск, досье, роль; отчёт: CSV", async ({ page }) => {
  await login(page, "admin");
  await page
    .getByRole("button", { name: "Клиенты", exact: true })
    .first()
    .click();
  await page.getByLabel("Имя или email…").fill("client@");
  await expect(page.getByText("client@atlet.kz")).toBeVisible();

  await page.locator("tr", { hasText: "client@atlet.kz" }).click();
  await expect(
    page.getByRole("dialog").getByText("записей всего"),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page
    .getByRole("button", { name: "Отчёты", exact: true })
    .first()
    .click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Скачать CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/atlet-report-.+\.csv/);
});

test("клиент не попадает в админку", async ({ page }) => {
  await login(page, "client");
  await page.goto("/#/admin");
  await expect(page.getByRole("heading", { name: /Привет/ })).toBeVisible();
});
