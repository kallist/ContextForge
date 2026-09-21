import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const root = ".studio-output/site";
const types = { ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".webm": "video/webm", ".json": "application/json", ".html": "text/html" };
const server = createServer(async (request, response) => {
  const raw = new URL(request.url ?? "/", "http://local").pathname;
  const relative = raw === "/" ? "index.html" : raw.endsWith("/") ? raw.slice(1) + "index.html" : raw.slice(1);
  const safe = normalize(relative).replaceAll("\\", "/");
  if (safe.startsWith("../") || safe.includes("/../")) { response.writeHead(404); response.end(); return; }
  try { response.setHeader("Content-Type", types[extname(safe)] ?? "application/octet-stream"); response.end(await readFile(join(root, safe))); }
  catch { response.writeHead(404); response.end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  const origin = "http://127.0.0.1:" + server.address().port;
  browser = await chromium.launch({ headless: true }); const page = await browser.newPage();
  const requests = [], errors = []; page.on("request", (request) => requests.push(request.url())); page.on("pageerror", (error) => errors.push(error.message));
  const routes = ["/", "/proof/", "/proof/task-context/", "/proof/review-context/", "/proof/context-debugging/"];
  for (const route of routes) {
    await page.goto(origin + route);
    assert.ok((await page.locator("body").innerText()).includes("RepoBound"));
    for (const [width, height] of [[390, 844], [1024, 768], [1512, 982]]) {
      await page.setViewportSize({ width, height }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.equal(await page.locator("img").evaluateAll((images) => images.filter((image) => !image.complete || image.naturalWidth === 0).length), 0);
      if (route === "/" && width === 1512) await page.screenshot({ path: ".studio-output/site-home-desktop.png", fullPage: true });
      if (route === "/" && width === 390) await page.screenshot({ path: ".studio-output/site-home-mobile.png", fullPage: true });
      if (route === "/proof/" && width === 1512) await page.screenshot({ path: ".studio-output/proof-lab-desktop.png", fullPage: true });
      if (route === "/proof/" && width === 390) await page.screenshot({ path: ".studio-output/proof-lab-mobile.png", fullPage: true });
    }
  }
  await page.goto(origin); assert.equal(await page.title(), "RepoBound — repository context, under your control");
  assert.equal(await page.locator('link[rel="canonical"]').getAttribute("href"), "https://kallist.github.io/RepoBound/");
  await page.locator("video").evaluate((video) => video.readyState >= 1 ? undefined : new Promise((resolve) => video.addEventListener("loadedmetadata", resolve, { once: true })));
  const duration = await page.locator("video").evaluate((video) => video.duration); assert.ok(duration >= 12 && duration <= 20, `Hero duration ${duration}s must remain 12–20 seconds`);
  assert.deepEqual(errors, []); assert.ok(requests.every((url) => new URL(url).origin === origin));
  console.log(JSON.stringify({ gate: "static site Chromium", routes: routes.length, viewports: [390, 1024, 1512], remoteRequests: 0, errors: 0, passed: true }));
} finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
