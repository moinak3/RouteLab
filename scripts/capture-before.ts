import { chromium, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.ROUTELAB_BEFORE_URL ?? "http://127.0.0.1:5176";
const outputDir = path.resolve("audit/screenshots");
const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const routes = [
  ["overview", "Overview"],
  ["traces", "Workloads", "Trace Library"],
  ["tasks", "Workloads", "Task Signatures"],
  ["library", "Quality", "Eval Library"],
  ["calibration", "Quality", "Human Calibration"],
  ["review-queue", "Quality", "Review Queue"],
  ["simulate", "Routing Simulations"],
  ["draft", "Routing Simulations"],
  ["decisions", "Routes", "Routing Decisions"],
  ["versions", "Routes", "Routing Decisions"],
  ["settings", "Settings"],
  ["benchmarking", "Benchmarking"],
  ["fine-tuning", "Routes", "Fine-Tuning Opportunities"],
  ["script-automation", "Routes", "Routing Decisions"],
] as const;

async function unlock(page: Page) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Get started" }).first().click();
  await page.locator('input[type="password"]').fill("Mochinder");
  await page.getByRole("button", { name: "Unlock RouteLab" }).click();
  await page.getByRole("heading", { name: "Overview", exact: true }).waitFor();
}

async function navigate(page: Page, route: readonly string[]) {
  if (route[1] === "Overview") return;
  const desktop = await page.locator("aside nav").isVisible();
  const parent = page.getByRole("button", { name: new RegExp(route[1]) }).last();
  if (route.length === 2) {
    await parent.click();
  } else if (desktop) {
    if (await parent.getAttribute("aria-expanded") !== "true") await parent.click();
    await page.locator("aside nav").getByRole("button", { name: route[2], exact: true }).click();
  } else {
    await parent.click();
    await page.locator(".group-mobile-subnav").getByRole("button", { name: route[2], exact: true }).click();
  }
  await page.waitForTimeout(120);
}

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: chrome });
for (const width of [375, 1440]) {
  const context = await browser.newContext({ viewport: { width, height: width === 375 ? 812 : 900 } });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(outputDir, `before-landing-${width}.png`), fullPage: true });
  await unlock(page);
  for (const route of routes) {
    await navigate(page, route);
    await page.screenshot({ path: path.join(outputDir, `before-${route[0]}-${width}.png`), fullPage: true });
  }
  await context.close();
}
await browser.close();
console.log("Captured pre-cleanup RouteLab reference screenshots.");
