import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const assets = new Map([["/", "index.html"], ["/site.css", "site.css"], ...["contextforge-hero.png", "contextforge-context.png", "contextforge-why.png", "contextforge-flow.svg", "social-card.png"].map((name) => ["/assets/" + name, "assets/" + name])]);
const server = createServer(async (req, res) => {
  const name = assets.get(req.url);
  if (!name) { res.writeHead(404); res.end(); return; }
  try {
    res.setHeader("Content-Type", name.endsWith(".css") ? "text/css" : name.endsWith(".png") ? "image/png" : name.endsWith(".svg") ? "image/svg+xml" : "text/html");
    res.end(await readFile(".studio-output/site/" + name));
  } catch { res.writeHead(500); res.end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  const origin = "http://127.0.0.1:" + server.address().port;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const requests = [], errors = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  for (const width of [390, 1024, 1280, 1512, 1920]) {
    await page.setViewportSize({ width, height: 982 });
    assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth));
    assert.equal(await page.locator("img").evaluateAll((imgs) => imgs.filter((i) => !i.complete || i.naturalWidth === 0).length), 0);
    if (width === 1280) await page.screenshot({ path: ".studio-output/site-1280.png", fullPage: true });
  }
  assert.deepEqual(errors, []);
  assert.ok(requests.every((url) => new URL(url).origin === origin));
  console.log(JSON.stringify({ gate: "static site Chromium", viewports: [390, 1024, 1280, 1512, 1920], remoteRequests: 0, errors: 0, passed: true }));
} finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
