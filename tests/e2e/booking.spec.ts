import { expect, test } from "@playwright/test";
import { uniqueEmail } from "./helpers";

async function registerFreshClient(
  page: import("@playwright/test").Page,
): Promise<string> {
  const email = uniqueEmail();
  await page.goto("/#/auth");
  await page.getByRole("tab", { name: "Регистрация" }).click();
  await page.getByLabel("Имя и фамилия").fill("Е2Е Клиент");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill("secret1");
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  // register() сам редиректит на schedule
  await expect(page.locator(".days")).toBeVisible({ timeout: 10_000 });
  return email;
}

test("полный цикл: запись → undo-отмена → возврат → отмена в кабинете", async ({
  page,
}) => {
  await registerFreshClient(page);

  // Fail fast: бэк лёг — падаем здесь, а не через 10с на bookedBtn
  await expect(
    page.getByRole("alert"),
    "Бэкенд недоступен — подними сервер",
  ).toBeHidden({ timeout: 10_000 });

  // 1. Первая bookable карточка
  const card = page
    .locator("article.session-card:not(.past)")
    .filter({ has: page.getByRole("button", { name: "Записаться" }) })
    .first();
  await expect(card).toBeVisible({ timeout: 5_000 });
  await card.scrollIntoViewIfNeeded();
  const title =
    (await card.getByRole("heading").first().textContent())?.trim() ?? "";

  // 2. Записываемся
  await card.getByRole("button", { name: "Записаться" }).click();

  // 3. Прямое следствие: кнопка стала "Вы записаны"
  await expect(card.getByRole("button", { name: "Вы записаны" })).toBeVisible({
    timeout: 10_000,
  });

  // 4. Toast подтверждения
  const anyToast = page.locator(".toast").first();
  await expect(anyToast).toBeVisible({ timeout: 10_000 });
  expect(((await anyToast.textContent()) ?? "").toLowerCase()).toMatch(
    /записан|запис|успешн/i,
  );
  const closeBtn = anyToast.locator(".toast-x");
  if (await closeBtn.count()) await closeBtn.click();

  // 5. Переход в "Мои записи"
  await page
    .locator('button:has-text("Мои записи"), button:has-text("Записи")')
    .first()
    .click();
  await expect(page.getByRole("heading", { name: title }).first()).toBeVisible({
    timeout: 8_000,
  });

  // 6. Отмена
  await page
    .locator(".booking-card:not(.past)")
    .getByRole("button", { name: "Отменить" })
    .first()
    .click();
  const cancelToast = page.locator(".toast").first();
  await expect(cancelToast).toBeVisible({ timeout: 8_000 });
  expect(((await cancelToast.textContent()) ?? "").toLowerCase()).toMatch(
    /отмен/,
  );

  // 7. Undo-возврат
  await cancelToast.getByRole("button", { name: "Вернуть" }).click();
  await expect(page.locator(".toast").first()).toBeVisible({ timeout: 8_000 });

  // 8. Финальная отмена
  await page
    .locator(".booking-card:not(.past)")
    .getByRole("button", { name: "Отменить" })
    .first()
    .click();
  await expect(page.locator(".toast").first()).toBeVisible({ timeout: 8_000 });

  // 9. Upcoming пусто
  await expect(
    page
      .getByText("Нет предстоящих записей.")
      .or(page.getByText("У вас пока нет записей.")),
  ).toBeVisible({ timeout: 8_000 });
});
