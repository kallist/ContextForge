// Verifies the static Proof pages in a real browser and captures their screenshots.
// Checks the four things a broken CSP silently breaks: the pages load, both bundled
// fonts actually load, nothing is logged as a CSP violation, and no remote request
// is made. Run `npm run site:e2e` (or `node scripts/build-site.mjs`) first.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve(".studio-output/site");
const out = ".studio-output/visual-v2/proof";
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".webm": "video/webm", ".woff2": "font/woff2" };

await stat(join(root, "index.html")).catch(() => { throw new Error("Built site missing. Run `node scripts/build-site.mjs` first."); });

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/u, "");
  // Windows normalize() rewrites "/" to "\", so both separators must be recognised.
  if (path === "" || path.endsWith("/") || path.endsWith("\\")) path = join(path, "index.html");
  const file = join(root, path);
  // Keep the static server inside the built site, as the real Pages host would.
  if (!file.startsWith(root)) { response.writeHead(403); response.end(); return; }
  void readFile(file).then(
    (body) => { response.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" }); response.end(body); },
    () => { response.writeHead(404); response.end(); },
  );
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;

const pages = [
  { name: "site-home", path: "/" },
  { name: "proof-home", path: "/proof/" },
  { name: "proof-task-context", path: "/proof/task-context/" },
  { name: "proof-review-context", path: "/proof/review-context/" },
  { name: "proof-context-debugging", path: "/proof/context-debugging/" },
];

const browser = await chromium.launch({ headless: true });
const report = [];
try {
  await mkdir(out, { recursive: true });
  for (const [index, entry] of pages.entries()) {
    const page = await browser.newPage({ viewport: [index === 0 ? { width: 1512, height: 982 } : { width: 1280, height: 900 }][0] });
    const consoleErrors = [], remote = [], failed = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
    page.on("request", (request) => { if (!request.url().startsWith(origin) && !request.url().startsWith("data:")) remote.push(request.url()); });
    page.on("requestfailed", (request) => failed.push(`${request.url()} :: ${request.failure()?.errorText}`));

    const response = await page.goto(origin + entry.path, { waitUntil: "load" });
    assert.equal(response.status(), 200, `${entry.path} must load`);
    await page.evaluate(() => document.fonts.ready);

    const fonts = await page.evaluate(() => ({
      plex: document.fonts.check('400 15px "IBM Plex Sans"'),
      mono: document.fonts.check('400 13px "JetBrains Mono"'),
      plexFaces: performance.getEntriesByType("resource").filter((r) => r.name.includes("plex-sans")).map((r) => `${r.name.split("/").pop()} ${Math.round(r.transferSize ?? 0)}B`),
      monoFaces: performance.getEntriesByType("resource").filter((r) => r.name.includes("jetbrains-mono")).map((r) => `${r.name.split("/").pop()} ${Math.round(r.transferSize ?? 0)}B`),
      csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? null,
      headingFont: getComputedStyle(document.querySelector("h1")).fontFamily,
    }));

    assert.equal(fonts.plex, true, `${entry.path}: IBM Plex Sans must load`);
    assert.equal(fonts.mono, true, `${entry.path}: JetBrains Mono must load`);
    assert.equal(fonts.plexFaces.length, 1, `${entry.path}: IBM Plex Sans woff2 must be fetched exactly once`);
    assert.equal(fonts.monoFaces.length, 1, `${entry.path}: JetBrains Mono woff2 must be fetched exactly once`);
    assert.deepEqual(consoleErrors, [], `${entry.path}: no console errors (CSP violations appear here)`);
    assert.deepEqual(remote, [], `${entry.path}: no remote requests`);
    assert.deepEqual(failed, [], `${entry.path}: no failed requests`);
    assert.ok(fonts.headingFont.includes("IBM Plex Sans"), `${entry.path}: the bundled UI font must be applied, found ${fonts.headingFont}`);

    const shot = `${out}/${entry.name}.png`;
    await page.screenshot({ path: shot, fullPage: true });
    report.push({ page: entry.path, status: 200, fonts: { plex: fonts.plex, mono: fonts.mono, plexFaces: fonts.plexFaces, monoFaces: fonts.monoFaces }, consoleErrors: 0, remoteRequests: 0, screenshot: shot });
    console.log(`${entry.path}  status=200  plex=${fonts.plex}  mono=${fonts.mono}  consoleErrors=0  remote=0  -> ${shot}`);
    await page.close();
  }
  console.log("\n" + JSON.stringify({ passed: true, pages: report.length, out, detail: report }, null, 2));
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
