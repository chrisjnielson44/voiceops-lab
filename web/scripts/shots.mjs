// Visual-check harness: log in (or use VITE_PREVIEW_BYPASS), then screenshot
// each dashboard page in both themes. Usage: node scripts/shots.mjs [tabs...]
// Point at the Vite dev server (default :5173) via PREVIEW_URL.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.PREVIEW_URL ?? "http://localhost:5173";
const EMAIL = "design-preview@voiceops.local";
const PASSWORD = "previewpass123";
const OUT = "design-preview";

const TABS = ["Cockpit", "Analytics", "Benchmarks", "Telephony"];
const THEMES = ["dark", "light"];
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : TABS;

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();

// ---- Sign in (skipped automatically when VITE_PREVIEW_BYPASS renders the shell) ----
await page.goto(BASE, { waitUntil: "networkidle" });
const emailField = page.locator("#auth-email");
if (await emailField.count()) {
  await emailField.fill(EMAIL);
  await page.locator("#auth-password").fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(3000);
}
await page.getByText("Voice Labs").first().waitFor({ timeout: 15000 });
console.log("ready");

for (const theme of THEMES) {
  await page.evaluate((t) => localStorage.setItem("voiceops-theme", t), theme);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  for (const tab of wanted) {
    await page.getByRole("button", { name: tab, exact: true }).first().click();
    await page.waitForTimeout(2500); // let lazy chunks + charts + motion settle
    const file = `${OUT}/${tab.toLowerCase()}-${theme}.png`;
    await page.screenshot({ path: file, fullPage: true });
    console.log("shot", file);
  }
}

await browser.close();
console.log("done");
