// Render docs/*.svg → docs/*.png at 2× via headless Chromium (uses the repo's
// installed Playwright, same as shots.mjs). Usage: node web/scripts/render-diagram.mjs
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const targets = ["architecture"]; // basenames under docs/

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
for (const name of targets) {
  const svg = readFileSync(path.join(root, "docs", `${name}.svg`), "utf8");
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff">${svg}</body></html>`, {
    waitUntil: "networkidle",
  });
  const el = await page.$("svg");
  const out = path.join(root, "docs", `${name}.png`);
  await el.screenshot({ path: out });
  console.log("wrote", out);
}
await browser.close();
