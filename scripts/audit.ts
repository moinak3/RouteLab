import { chromium, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.ROUTELAB_URL ?? "http://127.0.0.1:5175";
const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const outputDir = path.resolve("audit/screenshots");
const temporaryDir = path.resolve("/tmp/routelab-audit-screenshots");
const viewports = [[375, 812], [768, 1024], [1280, 800], [1440, 900]] as const;
const pages = [
  ["Overview", "Overview"], ["Traces", "Traces"], ["Tasks", "Tasks"],
  ["Library", "Evals", "Library"], ["Calibration", "Evals", "Calibration"], ["Review queue", "Evals", "Review queue"],
  ["Simulate", "Simulate"], ["Draft", "Policy", "Draft"], ["Decisions", "Policy", "Decisions"], ["Versions", "Policy", "Versions"],
  ["Settings", "Settings"], ["Benchmarking", "Labs", "Benchmarking"], ["Fine-tuning", "Labs", "Fine-tuning"], ["Script automation", "Labs", "Script automation"],
] as const;

async function unlock(page: Page) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Have a preview password?" }).click();
  await page.getByRole("textbox", { name: "Password" }).fill("Mochinder");
  await page.getByRole("button", { name: "Unlock RouteLab" }).click();
  await page.getByRole("heading", { name: "Overview" }).waitFor();
}

async function navigate(page: Page, route: readonly string[]) {
  const desktopNav = page.locator("aside nav");
  const mobile = !(await desktopNav.isVisible());
  const nav = mobile ? page.locator(".mobile-nav") : desktopNav;
  if (route.length === 2) {
    if (await page.getByRole("heading", { name: route[0], exact: true }).count()) return;
    await page.getByRole("button", { name: route[1], exact: true }).last().click();
  } else {
    const parent = page.getByRole("button", { name: new RegExp(`^${route[1]}`) }).last();
    if (mobile) {
      await parent.click();
      await page.locator(".group-mobile-subnav").getByRole("button", { name: route[2], exact: true }).click();
    } else {
      if (await parent.getAttribute("aria-expanded") !== "true") await parent.click();
      await nav.getByRole("button", { name: route[2], exact: true }).click();
    }
  }
  await page.waitForTimeout(150);
}

async function inspect(page: Page, label: string) {
  const result = await page.evaluate(() => {
    const visible = Array.from(document.querySelectorAll<HTMLElement>("body *")).filter((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    });
    const leafText = visible.filter((element) => element.children.length === 0 && element.textContent?.trim());
    const sizes = [...new Set(leafText.map((element) => getComputedStyle(element).fontSize))];
    const colors = [...new Set(leafText.map((element) => getComputedStyle(element).color))];
    const tiny = leafText.filter((element) => Number.parseFloat(getComputedStyle(element).fontSize) < 12).slice(0, 5).map((element) => element.textContent?.trim());
    const heavy = leafText.filter((element) => Number.parseInt(getComputedStyle(element).fontWeight, 10) > 700).slice(0, 5).map((element) => element.textContent?.trim());
    const forbidden = ["—", "Jev", "Distinct Task", "Task Signature", "SIGNALS", "Api ->", "$0.000"];
    const badText = leafText.filter((element) => forbidden.some((term) => element.textContent?.includes(term))).slice(0, 8).map((element) => element.textContent?.trim());
    const snake = leafText.filter((element) => /\b[a-z]+_[a-z0-9_]+\b/.test(element.textContent ?? "") && !getComputedStyle(element).fontFamily.toLowerCase().includes("dm mono") && !element.closest("pre, code, .mono-id")).slice(0, 8).map((element) => element.textContent?.trim());
    const loadedFonts: string[] = [];
    document.fonts.forEach((font) => {
      if (font.status === "loaded") loadedFonts.push(font.family.replaceAll('"', "").toLowerCase());
    });
    const unexpectedFonts = loadedFonts.filter((font) => !font.includes("inter") && !font.includes("dm mono"));
    const stepImages = Array.from(document.querySelectorAll<HTMLImageElement>(".home-step-card img")).map((image) => image.currentSrc || image.src);
    const repeatedStepImages = stepImages.filter((source, index) => stepImages.indexOf(source) !== index);
    return { overflow: document.documentElement.scrollWidth - innerWidth, sizes, colors, tiny, heavy, badText, snake, unexpectedFonts, repeatedStepImages };
  });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const failures: string[] = [];
  if (result.overflow > 0) failures.push(`horizontal overflow ${result.overflow}px`);
  if (result.tiny.length) failures.push(`text below 12px: ${result.tiny.join(" | ")}`);
  if (result.sizes.length > 8) failures.push(`${result.sizes.length} font sizes`);
  if (result.colors.length > 6) failures.push(`${result.colors.length} text colors`);
  if (result.heavy.length) failures.push(`font weight above 700: ${result.heavy.join(" | ")}`);
  if (result.badText.length) failures.push(`forbidden copy: ${result.badText.join(" | ")}`);
  if (result.snake.length) failures.push(`raw enum text: ${result.snake.join(" | ")}`);
  if (result.unexpectedFonts.length) failures.push(`unexpected fonts: ${[...new Set(result.unexpectedFonts)].join(" | ")}`);
  if (result.repeatedStepImages.length) failures.push(`repeated How it works images: ${[...new Set(result.repeatedStepImages)].join(" | ")}`);
  const contrast = axe.violations.filter((violation) => violation.id === "color-contrast");
  if (contrast.length) failures.push(`${contrast.reduce((sum, violation) => sum + violation.nodes.length, 0)} contrast failures`);
  if (failures.length) throw new Error(`${label}: ${failures.join("; ")}`);
}

await mkdir(outputDir, { recursive: true });
await mkdir(temporaryDir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: chrome });
const failures: string[] = [];
for (const [width, height] of viewports) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await inspect(page, `Landing ${width}x${height}`).catch((error) => failures.push(String(error)));
  await page.screenshot({ path: path.join(temporaryDir, `after-landing-${width}.png`), fullPage: true });
  await unlock(page);
  for (const route of pages) {
    await navigate(page, route);
    const slug = route[0].toLowerCase().replace(/[^a-z0-9]+/g, "-");
    await inspect(page, `${route[0]} ${width}x${height}`).catch((error) => failures.push(String(error)));
    if (width === 375 || width === 1440) await page.screenshot({ path: path.join(temporaryDir, `after-${slug}-${width}.png`), fullPage: true });
  }
  await context.close();
}
await browser.close();
await cp(temporaryDir, outputDir, { recursive: true });
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("RouteLab visual audit passed.");
