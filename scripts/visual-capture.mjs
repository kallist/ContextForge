// Visual verification harness for Visual Polish V2.
// Captures real screenshots AND records measured DOM/accessibility evidence, because
// an image alone is not a verifiable claim. Outputs to .studio-output/visual-v2/.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { createContextForgeLifecycle } from "../dist/composition/contextforge-lifecycle.js";
import { SqliteCapsuleHistory } from "../dist/adapters/sqlite/sqlite-capsule-history.js";
import { startStudio } from "../dist/adapters/studio/studio-server.js";

const out = ".studio-output/visual-v2";
const root = await realpath(await mkdtemp(join(tmpdir(), "repobound-visual-")));
let browser, studio, history;

function lum(hex) {
  const h = hex.trim().replace("#", "");
  const value = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * value[0] + 0.7152 * value[1] + 0.0722 * value[2];
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
}

try {
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "AGENTS.md"), "# Rules\nVerify changed session behavior before landing it.\n");
  for (const name of ["session", "refresh", "expiry"]) {
    await writeFile(join(root, "src", `${name}.ts`), [
      `export function ${name}(token: string) {`,
      ...Array.from({ length: 26 }, (_, n) => `  const step${n} = '${name}_evidence_${n}';`),
      `  return { token, name: '${name}' };`, "}", "",
    ].join("\n"));
  }
  await writeFile(join(root, "src", "session.test.ts"), "import { session } from './session.js';\nexport function testSession() { return session('t'); }\n");
  await writeFile(join(root, ".env"), "PRIVATE_SENTINEL=never_read\n");

  const app = await createContextForgeLifecycle(root);
  history = new SqliteCapsuleHistory(join(root, ".contextforge/history"));
  studio = await startStudio(app, history);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1512, height: 982 }, deviceScaleFactor: 2 });
  const errors = [], remote = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => { if (new URL(r.url()).origin !== studio.origin) remote.push(r.url()); });
  await page.goto(studio.url);
  await page.getByRole("status").filter({ hasText: "Ready." }).waitFor();

  const report = { fonts: {}, contrast: {}, ruler: {}, focus: {}, overflow: {}, inspector: {}, screenshots: [] };

  // ---- fonts actually loaded from the local server, no remote request --------
  report.fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    const loaded = [...document.fonts].map((f) => ({ family: f.family, weight: f.weight, status: f.status }));
    return { loaded, plexReady: document.fonts.check('400 15px "IBM Plex Sans"'), monoReady: document.fonts.check('400 13px "JetBrains Mono"') };
  });
  assert.equal(report.fonts.plexReady, true, "IBM Plex Sans must load from the local server");
  assert.equal(report.fonts.monoReady, true, "JetBrains Mono must load from the local server");

  // ---- compile a real capsule ----------------------------------------------
  await page.locator("#task").fill("Fix the session race condition");
  await page.locator("#budget").fill("900");
  await page.getByRole("button", { name: "Build Context →", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Compiled and saved" }).waitFor();

  // ---- ruler geometry: real numbers, correct proportions --------------------
  report.ruler = await page.evaluate(() => {
    const used = document.querySelector(".ruler-used").getBoundingClientRect();
    const track = document.querySelector(".ruler-track").getBoundingClientRect();
    return {
      trackWidth: Math.round(track.width),
      usedWidth: Math.round(used.width),
      usedShare: Math.round((used.width / track.width) * 1000) / 10,
      label: document.querySelector(".ruler").getAttribute("aria-label"),
      visibleAtTop: document.querySelector(".ruler").getBoundingClientRect().top < globalThis.innerHeight,
      rulerTop: Math.round(document.querySelector(".ruler").getBoundingClientRect().top),
      firstRowTop: Math.round(document.querySelector("#candidates tr").getBoundingClientRect().top),
    };
  });
  assert.match(report.ruler.label, /of 900 estimator tokens used/, "ruler must state real recorded values");

  // ---- contrast of the tokens actually rendered -----------------------------
  report.contrast = await page.evaluate(() => {
    const bg = getComputedStyle(document.body).backgroundColor;
    const pick = (sel) => { const e = document.querySelector(sel); return e ? { color: getComputedStyle(e).color, size: getComputedStyle(e).fontSize } : null; };
    return { background: bg, body: pick("body"), muted: pick(".muted"), eyebrow: pick(".eyebrow"), status: pick(".status"), tag: pick(".tag.SELECTED"), th: pick("thead th"), td: pick("td:nth-child(3)") };
  });
  const toHex = (rgb) => "#" + rgb.match(/\d+/gu).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("");
  const bgHex = toHex(report.contrast.background);
  report.contrast.measured = Object.fromEntries(Object.entries(report.contrast)
    .filter(([, v]) => v && typeof v === "object" && v.color)
    .map(([k, v]) => [k, { hex: toHex(v.color), size: v.size, ratioOnBackground: ratio(toHex(v.color), bgHex) }]));

  // ---- capture: context workbench at the three target viewports -------------
  await mkdir(out, { recursive: true });
  for (const [width, height] of [[1512, 982], [1280, 800], [1024, 768]]) {
    await page.setViewportSize({ width, height });
    await page.locator('[data-nav="context"]').click();
    await page.locator('[data-tab="proposal"]').click();
    await page.waitForTimeout(120);
    report.overflow[`${width}x${height}`] = await page.evaluate(() => ({
      scrollWidth: globalThis.document.documentElement.scrollWidth,
      innerWidth: globalThis.innerWidth,
      overflow: globalThis.document.documentElement.scrollWidth > globalThis.innerWidth,
      rulerVisible: document.querySelector(".ruler").getBoundingClientRect().top < globalThis.innerHeight,
    }));
    assert.equal(report.overflow[`${width}x${height}`].overflow, false, `no horizontal overflow at ${width}`);
    const file = `${out}/context-${width}x${height}.png`;
    await page.screenshot({ path: file, fullPage: true });
    report.screenshots.push(file);
  }

  // ---- detail crops at 2x for close inspection ------------------------------
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.locator('[data-nav="context"]').click();
  await page.locator('[data-tab="proposal"]').click();
  await page.waitForTimeout(120);
  for (const [name, selector] of [["composer", "#start"], ["summary+ruler", ".context-summary"], ["context-list", ".context-pane"], ["view-tabs", ".view-tabs"]]) {
    const locator = page.locator(selector).first();
    if (await locator.count()) { const file = `${out}/${name.replace(/[^a-z0-9]+/giu, "-")}.png`; await locator.screenshot({ path: file }); report.screenshots.push(file); }
  }

  // ---- borderless controls check -------------------------------------------
  report.focus = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")];
    const borderless = buttons.filter((b) => getComputedStyle(b).borderTopWidth === "0px").length;
    return { totalButtons: buttons.length, borderlessButtons: borderless };
  });

  // ---- Why inspector on a real dropped file --------------------------------
  await page.locator("#filter").selectOption("DROPPED");
  const dropped = page.locator("#candidates tr").first();
  assert.ok(await dropped.count() > 0, "fixture must produce at least one considered-but-not-selected file");
  await dropped.getByRole("button").click();
  await page.getByRole("status").filter({ hasText: "Explain: OK" }).waitFor();
  await page.locator('[data-nav="context"]').click();
  await page.locator('[data-tab="evidence"]').click();
  await page.waitForTimeout(150);
  report.inspector = await page.evaluate(() => {
    const explain = document.querySelector("#explain");
    const lead = explain.querySelector(".reason-lead");
    const details = explain.querySelector("details");
    return {
      leadText: lead ? lead.textContent.slice(0, 200) : null,
      hasReasonLead: Boolean(lead),
      evidenceItems: explain.querySelectorAll(".evidence-item").length,
      hasDecisionDetails: Boolean(details),
      rawCodesHiddenByDefault: details ? !details.open : false,
      rawCodeVisibleInLead: lead ? /·\s*(STRUCTURAL|LEXICAL|HEURISTIC)/u.test(lead.textContent) : null,
      selectionBarVisible: !document.querySelector("#selection-bar").hidden,
      selectionBarText: document.querySelector("#selection-bar").textContent.slice(0, 80),
    };
  });
  assert.equal(report.inspector.hasReasonLead, true, "inspector must lead with a human-readable reason");
  assert.equal(report.inspector.rawCodesHiddenByDefault, true, "raw provenance codes must be behind a disclosure");
  assert.equal(report.inspector.selectionBarVisible, true, "selecting a file must reveal the action bar");
  const whyFile = `${out}/why-inspector.png`;
  await page.screenshot({ path: whyFile, fullPage: true });
  report.screenshots.push(whyFile);
  const whyPane = `${out}/why-pane.png`;
  await page.locator(".why-pane").screenshot({ path: whyPane });
  report.screenshots.push(whyPane);

  // ---- Snapshot ------------------------------------------------------------
  await page.locator("#share").click();
  await page.waitForTimeout(200);
  const snapshotFile = `${out}/context-snapshot.png`;
  await page.locator("#snapshot").screenshot({ path: snapshotFile });
  report.screenshots.push(snapshotFile);
  report.snapshot = await page.locator("#snapshot").evaluate((c) => ({ width: c.width, height: c.height }));
  await page.locator("#share-close").click();

  // ---- keyboard operation --------------------------------------------------
  await page.locator('[data-nav="context"]').click();
  await page.locator('[data-tab="proposal"]').click();
  await page.locator("#candidates tr").first().getByRole("button").focus();
  report.focus.rowFocusVisible = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== "none");
  await page.keyboard.press("Enter");
  await page.getByRole("status").filter({ hasText: "Explain: OK" }).waitFor();
  report.focus.enterOpensExplain = true;

  // ---- reduced motion ------------------------------------------------------
  await page.emulateMedia({ reducedMotion: "reduce" });
  report.focus.reducedMotionTransition = await page.evaluate(() => getComputedStyle(document.querySelector(".ruler-used")).transitionDuration);
  await page.emulateMedia({ reducedMotion: null });

  assert.deepEqual(remote, [], "no remote requests: fonts must be local");
  assert.deepEqual(errors, []);

  await writeFile(`${out}/measurements.json`, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ok: true, out, ruler: report.ruler, inspector: report.inspector, contrast: report.contrast.measured, overflow: report.overflow, fonts: report.fonts.loaded, snapshots: report.screenshots.length }, null, 2));
} finally {
  await browser?.close();
  await studio?.close();
  history?.close();
  await rm(root, { recursive: true, force: true });
}
