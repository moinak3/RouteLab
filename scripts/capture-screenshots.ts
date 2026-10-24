import { chromium, type Locator, type Page } from "@playwright/test";
import sharp from "sharp";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.ROUTELAB_URL ?? "http://127.0.0.1:5175";
const outputDir = path.resolve("public/marketing");
const temporaryDir = path.resolve("/tmp/routelab-marketing-captures");
const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function unlock(page: Page) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Have a preview password?" }).click();
  await page.getByRole("textbox", { name: "Password" }).fill("Mochinder");
  await page.getByRole("button", { name: "Unlock RouteLab" }).click();
  await page.getByRole("heading", { name: "Overview" }).waitFor();
}

async function openTopLevel(page: Page, name: string) {
  await page.locator("aside nav").getByRole("button", { name, exact: true }).click();
  await page.waitForTimeout(250);
}

async function openChild(page: Page, parent: string, child: string) {
  const parentButton = page.locator("aside nav").getByRole("button", { name: new RegExp(`^${parent}`) }).first();
  if (await parentButton.getAttribute("aria-expanded") !== "true") await parentButton.click();
  await page.locator("aside nav").getByRole("button", { name: child, exact: true }).click();
  await page.waitForTimeout(250);
}

async function capture(page: Page, locator: Locator, name: string) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`Could not measure ${name}`);
  const jpg = path.join(temporaryDir, `${name}.jpg`);
  const webp = path.join(temporaryDir, `${name}.webp`);
  await page.screenshot({ path: jpg, type: "jpeg", quality: 88, animations: "disabled", clip: { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.min(box.width, 1240), height: Math.min(box.height, 700) } });
  await sharp(jpg).webp({ quality: 84 }).toFile(webp);
}

await mkdir(outputDir, { recursive: true });
await mkdir(temporaryDir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: chrome });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();
await unlock(page);
await page.locator(".overview-decision-summary").getByText("Saved · not published").waitFor();

await capture(page, page.locator(".overview-routing-state"), "hero-policy");
await openTopLevel(page, "Traces");
await capture(page, page.locator(".traces-page > .panel"), "observe");
await openTopLevel(page, "Tasks");
await capture(page, page.locator(".task-table-panel"), "classify");
await openChild(page, "Evals", "Calibration");
await capture(page, page.locator(".calibration-panel"), "prove");
await openTopLevel(page, "Simulate");
await capture(page, page.locator(".scenario-results"), "compare");
await openChild(page, "Policy", "Draft");
await capture(page, page.locator(".routing-policy-builder"), "approve");
await capture(page, page.locator(".sidecar-export"), "enforce");

await browser.close();
for (const name of ["hero-policy", "observe", "classify", "prove", "compare", "approve", "enforce"]) {
  await copyFile(path.join(temporaryDir, `${name}.jpg`), path.join(outputDir, `${name}.jpg`));
  await copyFile(path.join(temporaryDir, `${name}.webp`), path.join(outputDir, `${name}.webp`));
}
console.log(`Captured RouteLab marketing screenshots in ${outputDir}`);
