import { expect, test } from "@playwright/test";
import { login } from "./helpers";

const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

for (const vp of viewports) {
  test(`расписание и запись на ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await login(page, "client");
    await expect(page.getByRole("heading", { name: /Привет/ })).toBeVisible();

    const card = page.getByRole("group").first();
    await card.scrollIntoViewIfNeeded();
    const box = (await card.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);

    await card.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const dlgBox = (await page.getByRole("dialog").boundingBox())!;
    expect(dlgBox.width).toBeLessThanOrEqual(vp.width);
    await page.keyboard.press("Escape");
  });
}

test("мобильная нижняя навигация фиксируется внизу", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "client");
  await page.waitForTimeout(300);
  const nav = page.locator(".mob-nav");
  await expect(nav).toBeVisible();
  const box = await nav.boundingBox();
  expect(box, "mob-nav bounding box не получен").not.toBeNull();
  expect(box!.y).toBeGreaterThan(700);
  expect(box!.height).toBeGreaterThan(50);
});
test("горизонтального скролла нет ни на одном вьюпорте", async ({ page }) => {
  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(
      overflow,
      `${vp.name}: горизонтальный скролл ${overflow}px`,
    ).toBeLessThanOrEqual(0);
  }
});
