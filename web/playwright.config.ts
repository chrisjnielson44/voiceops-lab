import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against the built SPA served by `vite preview`, with the auth gate bypassed
 * (VITE_PREVIEW_BYPASS=1 baked in at build) so it runs in CI with no backend/DB.
 * API calls fail gracefully; these tests assert UI structure + routing.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run build && npm run preview",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { VITE_PREVIEW_BYPASS: "1" },
  },
});
