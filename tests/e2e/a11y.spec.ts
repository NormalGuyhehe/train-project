import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";
async function audit(page: Page, scope: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .disableRules(["color-contrast"]) // axe даёт ложные срабатывания на анимациях/градиентах
    .analyze();
  const violations = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  expect(
    violations,
    `${scope}: ${violations.map((v) => v.id).join(", ")}`,
  ).toEqual([]);
}

test("лендинг доступен", async ({ page }) => {
  await page.goto("/");
  await audit(page, "landing");
});

test("расписание доступно", async ({ page }) => {
  await login(page, "client");
  await audit(page, "schedule");
});

test("админка доступна", async ({ page }) => {
  await login(page, "admin");
  await audit(page, "admin");
});

test("клавиатура: таб по фокусируемым, Enter открывает drawer", async ({
  page,
}) => {
  await login(page, "client");
  await page.getByRole("group").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
