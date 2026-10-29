import { chromium } from "playwright";
import assert from "node:assert/strict";

const baseUrl = process.env.ROUTELAB_URL ?? "http://127.0.0.1:5175";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });

const inspect = async () => page.evaluate(() => {
  const rect = (element) => {
    const box = element.getBoundingClientRect();
    return {
      x: Number(box.x.toFixed(1)),
      y: Number(box.y.toFixed(1)),
      width: Number(box.width.toFixed(1)),
      height: Number(box.height.toFixed(1)),
    };
  };
  const fields = [...document.querySelectorAll(".scenario-controls > :not(.scenario-note)")].map((element) => ({
    className: element.className,
    box: rect(element),
    control: rect(element.querySelector("summary,.range-tabs,.request-limit>div") ?? element),
  }));
  const policy = [...document.querySelectorAll(".routing-policy-controls > label")].map((element) => ({
    box: rect(element),
    control: rect(element.querySelector("select,input,.policy-threshold")),
  }));
  return {
    viewport: window.innerWidth,
    fields,
    policy,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Get started/i }).first().click();
  await page.locator('input[type="password"]').fill("Mochinder");
  await page.getByRole("button", { name: /Unlock RouteLab/i }).click();
  await page.waitForTimeout(500);
  const demo = page.getByRole("button", { name: /Open demo workspace/i });
  if (await demo.count()) await demo.click();

  await page.goto(`${baseUrl}/routing-simulations`, { waitUntil: "networkidle" });
  await page.locator(".scenario-controls").waitFor();
  for (const width of [1600, 1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 900 : 1100 });
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(".scenario-controls").waitFor();
    const layout = await inspect();
    const scenarioWidths = new Set(layout.fields.map((field) => field.control.width));
    const scenarioHeights = new Set(layout.fields.map((field) => field.control.height));
    const policyWidths = new Set(layout.policy.map((field) => field.control.width));
    const policyHeights = new Set(layout.policy.map((field) => field.control.height));

    assert.equal(scenarioWidths.size, 1, `${width}px scenario controls must have equal widths`);
    assert.equal(scenarioHeights.size, 1, `${width}px scenario controls must have equal heights`);
    assert.equal(policyWidths.size, 1, `${width}px policy controls must have equal widths`);
    assert.equal(policyHeights.size, 1, `${width}px policy controls must have equal heights`);
    assert.equal(layout.overflow, 0, `${width}px page must not overflow horizontally`);
    console.log(`${width}px layout verified`, JSON.stringify(layout));

    if (width === 1440) {
      await page.screenshot({ path: "/tmp/routelab-simulation-controls-desktop.png", fullPage: true });
    }
    if (width === 390) {
      await page.screenshot({ path: "/tmp/routelab-simulation-controls-mobile.png", fullPage: true });
    }
  }
} finally {
  await browser.close();
}
