import { test, expect } from "@playwright/test";

test("loads the cockpit shell (auth bypassed in preview)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("VoiceOps Lab")).toBeVisible();
  // Header title for the landing (cockpit) route.
  await expect(page.getByRole("heading", { name: "Cockpit" })).toBeVisible();
});

test("routes between the four tabs", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Analytics", exact: true }).click();
  await expect(page).toHaveURL(/\/analytics$/);
  await expect(page.getByRole("heading", { name: "Operations analytics" })).toBeVisible();

  await page.getByRole("button", { name: "Voice", exact: true }).click();
  await expect(page).toHaveURL(/\/voice$/);
  await expect(page.getByRole("heading", { name: "Voice agent sandbox" })).toBeVisible();

  await page.getByRole("button", { name: "Telephony", exact: true }).click();
  await expect(page).toHaveURL(/\/telephony$/);
  await expect(page.getByText(/Real-number calling/)).toBeVisible();

  await page.getByRole("button", { name: "Cockpit", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});
