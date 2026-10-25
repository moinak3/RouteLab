import { writeFile } from "node:fs/promises";

const appUrl = process.env.ROUTELAB_URL ?? "http://127.0.0.1:5173/";
const previewPassword = process.env.ROUTELAB_PREVIEW_PASSWORD ?? "Mochinder";
const target = await fetch(`http://127.0.0.1:9222/json/new?${encodeURIComponent(appUrl)}`, { method: "PUT" }).then((response) => response.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();

socket.addEventListener("message", (event) => {
  const payload = JSON.parse(event.data);
  if (!payload.id || !pending.has(payload.id)) return;
  const { resolve, reject } = pending.get(payload.id);
  pending.delete(payload.id);
  payload.error ? reject(new Error(payload.error.message)) : resolve(payload.result);
});

await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));

function send(method, params = {}) {
  const messageId = ++id;
  socket.send(JSON.stringify({ id: messageId, method, params }));
  return new Promise((resolve, reject) => pending.set(messageId, {
    resolve,
    reject: (error) => reject(new Error(`${method}: ${error.message}`)),
  }));
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  return result.result?.value;
}

async function navigate(path) {
  await send("Page.navigate", { url: new URL(path, appUrl).href });
  await wait(700);
}

async function waitFor(selector, timeout = 8_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return;
    await wait(120);
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

async function clickByText(selector, text) {
  const clicked = await evaluate(`(() => {
    const element = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
      .find((candidate) => candidate.textContent?.trim().includes(${JSON.stringify(text)}));
    element?.click();
    return Boolean(element);
  })()`);
  if (!clicked) throw new Error(`Could not find ${selector} containing ${text}`);
}

async function capture(name, selector, maxHeight) {
  await waitFor(selector);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: "start", behavior: "instant" })`);
  await wait(220);
  const rect = await evaluate(`(() => {
    const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return {
      x: Math.max(0, box.left + window.scrollX),
      y: Math.max(0, box.top + window.scrollY),
      width: box.width,
      height: Math.min(box.height, ${maxHeight}),
    };
  })()`);
  const screenshot = await send("Page.captureScreenshot", {
    format: "jpeg",
    quality: 90,
    captureBeyondViewport: true,
    clip: { ...rect, scale: 1 },
  });
  await writeFile(`public/marketing/${name}.jpg`, Buffer.from(screenshot.data, "base64"));
}

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await navigate("/");
await clickByText("button", "Get Started");
await waitFor('input[type="password"]');
await evaluate(`(() => {
  const input = document.querySelector('input[type="password"]');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, ${JSON.stringify(previewPassword)});
  input.dispatchEvent(new Event("input", { bubbles: true }));
})()`);
await clickByText("button", "Unlock RouteLab");
await wait(700);

await navigate("/workloads/task-groups");
await clickByText("button", "Generate Task Groups");
await waitFor(".task-table-panel");
await capture("task-groups", ".task-signatures-page", 800);

await clickByText('button[role="radio"]', "LLM grouped");
await waitFor('.llm-view-switch button[role="tab"]');
await clickByText('.llm-view-switch button[role="tab"]', "Compare methods");
await waitFor(".llm-comparison");
await capture("compare-methods", ".llm-comparison", 820);

await navigate("/routing-simulations");
await capture("routing-simulations-current", ".scenario-results", 360);
await capture("policy-history", ".policy-publish-workflow", 620);

await navigate("/quality/review-queue");
await capture("review-queue", ".review-page", 820);

socket.close();
