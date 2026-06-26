// Screenshot the logged-out auth page in both themes. Usage: node scripts/auth-shot.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.PREVIEW_URL ?? "http://localhost:5175";
const OUT = "design-preview";
const THEMES = ["dark", "light"];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 832 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

for (const theme of THEMES) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("voiceops-theme", t), theme);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#auth-email").waitFor({ timeout: 15000 });
  await page.waitForTimeout(2200); // let the waves canvas animate in
  const file = `${OUT}/auth-${theme}.png`;
  await page.screenshot({ path: file });
  console.log("shot", file);
}

await browser.close();
console.log("done");
