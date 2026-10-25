import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.ROUTELAB_URL ?? "http://127.0.0.1:5173";
const shouldCapture = process.argv.includes("--capture-after");
const widths = [375, 768, 1440];
const allowedFontFamilies = new Set(["Inter Variable", "DM Mono"]);
const destinations = [
  { name: "Overview", top: "Overview" },
  { name: "Traces", top: "Workloads", child: "Traces" },
  { name: "Task Groups", top: "Workloads", child: "Task Groups" },
  { name: "Eval Library", top: "Quality", child: "Eval Library" },
  { name: "Human Calibration", top: "Quality", child: "Human Calibration" },
  { name: "Review Queue", top: "Quality", child: "Review Queue" },
  { name: "Routing Simulations", top: "Routing Simulations" },
  { name: "Benchmarking", top: "Benchmarking" },
  { name: "Settings", top: "Settings" },
];

const clickAttachedControl = async (page, label, selector = "button") => {
  const control = page.locator(selector).filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).first();
  await control.waitFor({ state: "attached" });
  await control.evaluate((element) => element.click());
  await page.waitForTimeout(50);
};

const openDestination = async (page, destination) => {
  await clickAttachedControl(page, destination.top, ".mobile-nav button");
  if (destination.child) await clickAttachedControl(page, destination.child, ".group-mobile-subnav button");
  await page.locator("main").waitFor({ state: "visible" });
};

const inspectTypography = async (page) => page.evaluate(async () => {
  await document.fonts.ready;
  const visibleText = [...document.querySelectorAll("body *")].filter((element) => {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    return [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
  });
  const records = visibleText.map((element) => {
    const style = getComputedStyle(element);
    const weight = style.fontWeight === "normal" ? 400 : style.fontWeight === "bold" ? 700 : Number(style.fontWeight);
    return {
      tag: element.tagName.toLowerCase(),
      className: typeof element.className === "string" ? element.className : "",
      text: element.textContent?.trim().replace(/\s+/g, " ").slice(0, 100) ?? "",
      size: Number.parseFloat(style.fontSize),
      weight,
      family: style.fontFamily,
    };
  });
  const sizes = [...new Set(records.map((record) => record.size))].sort((a, b) => a - b);
  const loadedFonts = [...document.fonts].map((font) => font.family.replace(/["']/g, ""));
  const buttonsThatWrap = [...document.querySelectorAll("button")]
    .filter((button) => {
      const style = getComputedStyle(button);
      const rect = button.getBoundingClientRect();
      return rect.width && rect.height && style.display !== "none" && style.visibility !== "hidden" && style.whiteSpace !== "nowrap";
    })
    .map((button) => button.textContent?.trim().replace(/\s+/g, " ").slice(0, 100) ?? "");
  return {
    sizes,
    underMinimum: records.filter((record) => record.size < 12),
    overWeight: records.filter((record) => record.weight > 700),
    loadedFonts,
    buttonsThatWrap,
  };
});

const browser = await chromium.launch({ headless: true });
const failures = [];
const results = [];

try {
  for (const width of widths) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    const landing = await inspectTypography(page);
    results.push({ width, page: "Landing", ...landing });
    if (shouldCapture && [375, 1440].includes(width)) {
      await page.screenshot({ path: path.join("docs", "typography", `after-landing-${width}.png`), fullPage: true });
    }

    await page.getByRole("button", { name: "Get started" }).first().click();
    await page.locator('input[type="password"]').fill("Mochinder");
    await page.getByRole("button", { name: "Unlock RouteLab" }).click();
    await page.getByRole("heading", { name: "Overview" }).waitFor();

    for (const destination of destinations) {
      await openDestination(page, destination);
      const audit = await inspectTypography(page);
      results.push({ width, page: destination.name, ...audit });
      if (shouldCapture && destination.name === "Overview" && [375, 1440].includes(width)) {
        await page.screenshot({ path: path.join("docs", "typography", `after-overview-${width}.png`), fullPage: true });
      }
    }

    await page.close();
  }

  for (const result of results) {
    const unexpectedFonts = result.loadedFonts.filter((family) => !allowedFontFamilies.has(family));
    if (result.underMinimum.length) failures.push(`${result.width}px ${result.page}: ${result.underMinimum.length} visible text nodes under 12px (${result.underMinimum.slice(0, 5).map((item) => `${item.tag}.${item.className || "-"}=${item.size}:${item.text}`).join(" | ")})`);
    if (result.sizes.length > 8) failures.push(`${result.width}px ${result.page}: ${result.sizes.length} computed font sizes (${result.sizes.join(", ")})`);
    if (result.overWeight.length) failures.push(`${result.width}px ${result.page}: ${result.overWeight.length} visible text nodes above weight 700 (${result.overWeight.slice(0, 5).map((item) => `${item.tag}.${item.className || "-"}=${item.weight}:${item.text}`).join(" | ")})`);
    if (unexpectedFonts.length) failures.push(`${result.width}px ${result.page}: unexpected loaded fonts (${[...new Set(unexpectedFonts)].join(", ")})`);
    if (result.buttonsThatWrap.length) failures.push(`${result.width}px ${result.page}: buttons without nowrap (${result.buttonsThatWrap.join(", ")})`);
  }

  for (const result of results) {
    console.log(`${String(result.width).padStart(4)}px  ${result.page.padEnd(26)} sizes=${result.sizes.join(",")} fonts=${[...new Set(result.loadedFonts)].join(",")}`);
  }

  if (failures.length) {
    console.error(`\nTypography verification failed:\n- ${failures.join("\n- ")}`);
    process.exitCode = 1;
  } else {
    console.log(`\nTypography verification passed across ${results.length} page/viewport combinations.`);
  }
} finally {
  await browser.close();
}
