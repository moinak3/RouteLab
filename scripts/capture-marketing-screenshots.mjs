import { writeFile } from "node:fs/promises";

const pageTarget = await fetch("http://127.0.0.1:9222/json/new?http://127.0.0.1:5173/", { method: "PUT" }).then((response) => response.json());
const socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();

socket.addEventListener("message", (event) => {
  const payload = JSON.parse(event.data);
  if (payload.id && pending.has(payload.id)) {
    const { resolve, reject } = pending.get(payload.id);
    pending.delete(payload.id);
    payload.error ? reject(new Error(payload.error.message)) : resolve(payload.result);
  }
});

await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));

function send(method, params = {}) {
  const messageId = ++id;
  socket.send(JSON.stringify({ id: messageId, method, params }));
  return new Promise((resolve, reject) => pending.set(messageId, { resolve, reject }));
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function evaluate(expression) {
  return send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
}

async function capture(name) {
  await wait(450);
  const result = await send("Page.captureScreenshot", { format: "jpeg", quality: 86, captureBeyondViewport: false });
  await writeFile(`public/marketing/${name}.jpg`, Buffer.from(result.data, "base64"));
}

await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url: "http://127.0.0.1:5173/" });
await wait(900);
await evaluate(`Array.from(document.querySelectorAll('button')).find((button)=>button.textContent?.includes('Run the 48-hour assessment'))?.click()`);
await wait(200);
await evaluate(`const input=document.querySelector('input[type=password]'); if(input){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Mochinder'); input.dispatchEvent(new Event('input',{bubbles:true}));}`);
await wait(150);
await evaluate(`Array.from(document.querySelectorAll('button')).find((button)=>button.textContent?.includes('Unlock RouteLab'))?.click()`);
await wait(900);

for (const [page, file] of [
  ["Traces", "traces"],
  ["Golden Dataset", "evals"],
  ["Simulations", "simulations"],
  ["Recommendations", "recommendations"],
]) {
  await evaluate(`Array.from(document.querySelectorAll('aside nav button,.mobile-nav button')).find((button)=>button.textContent?.trim()==='${page}')?.click()`);
  await wait(900);
  await capture(file);
}

socket.close();
