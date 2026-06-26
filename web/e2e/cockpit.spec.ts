import { test, expect } from "@playwright/test";

test("loads the cockpit shell (auth bypassed in preview)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Voice Labs")).toBeVisible();
  await expect(page.getByRole("button", { name: "New session" })).toBeVisible();
});

test("routes between primary sections", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Studio", exact: true }).click();
  await expect(page).toHaveURL(/\/studio$/);
  await expect(page.getByRole("heading", { name: "Configure a session" })).toBeVisible();

  await page.getByRole("button", { name: "Analytics", exact: true }).click();
  await expect(page).toHaveURL(/\/analytics$/);
  await expect(page.getByRole("heading", { name: "Operations analytics" })).toBeVisible();

  await page.getByRole("button", { name: "Integrations", exact: true }).click();
  await expect(page).toHaveURL(/\/integrations$/);
  await expect(page.getByRole("heading", { name: "Integrations" })).toBeVisible();

  await page.getByRole("button", { name: "Logs & Audit", exact: true }).click();
  await expect(page).toHaveURL(/\/logs$/);
  await expect(page.getByRole("heading", { name: "Logs & Audit" })).toBeVisible();

  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});
