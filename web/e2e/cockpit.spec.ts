import { test, expect } from "@playwright/test";

test("loads the cockpit shell (auth bypassed in preview)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Voice Labs")).toBeVisible();
  await expect(page.getByText("Start a session")).toBeVisible();
});

test("routes between primary sections", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Simulation", exact: true }).click();
  await expect(page).toHaveURL(/\/simulate$/);
  await expect(page.getByRole("heading", { name: "Simulation" })).toBeVisible();

  await page.getByRole("button", { name: "Analytics", exact: true }).click();
  await expect(page).toHaveURL(/\/analytics$/);
  await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();

  await page.getByRole("button", { name: "Integrations", exact: true }).click();
  await expect(page).toHaveURL(/\/integrations$/);
  await expect(page.getByRole("heading", { name: "Integrations" })).toBeVisible();

  await page.getByRole("button", { name: "Logs", exact: true }).click();
  await expect(page).toHaveURL(/\/logs$/);
  await expect(page.getByRole("heading", { name: "Logs" })).toBeVisible();

  await page.getByRole("button", { name: "Audit", exact: true }).click();
  await expect(page).toHaveURL(/\/audit$/);
  await expect(page.getByRole("heading", { name: "Audit" })).toBeVisible();

  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});
