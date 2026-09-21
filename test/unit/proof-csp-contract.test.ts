import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

// Regression guard for the malformed font-src CSP.
//
// The first V2 proof-page edit inserted `font-src 'self';` without the directive
// separator, producing `form-action 'none' font-src 'self';` -- a single invalid
// directive. Browsers discard an unrecognised directive, so the page silently lost
// the protections it was meant to keep, including `default-src 'none'`. A whole-policy
// match is therefore not enough: each directive must be validated on its own.

const REPO_ROOT = (() => {
  let current = resolve(import.meta.dirname);
  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(join(current, "site", "proof", "index.html"))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error("Could not locate the repository root from the compiled test location.");
})();
const SITE = join(REPO_ROOT, "site");
const STUDIO_FONTS = join(REPO_ROOT, "src", "adapters", "studio", "assets", "fonts");

const CSP_META = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/iu;
const PAGES = ["proof/index.html", "proof/task-context/index.html", "proof/review-context/index.html", "proof/context-debugging/index.html", "index.html"];

/** Directives in the order written, each with its source value split into whitespace tokens. */
function parseCsp(text: string): { name: string; values: string[]; raw: string }[] {
  const match = CSP_META.exec(text);
  assert.ok(match?.[1], "page must declare a Content-Security-Policy meta tag");
  return match[1]
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((directive) => {
      const [name, ...values] = directive.split(/\s+/u);
      return { name: name ?? "", values, raw: directive };
    });
}

function directivesOf(file: string): { name: string; values: string[]; raw: string }[] {
  return parseCsp(readFileSync(join(SITE, file), "utf8"));
}

test("every CSP directive is well formed and separated", () => {
  for (const file of PAGES) {
    for (const directive of directivesOf(file)) {
      assert.match(directive.name, /^[a-z][a-z0-9-]*$/u, `${file}: invalid directive name "${directive.name}" in "${directive.raw}"`);
      for (const value of directive.values) {
        assert.match(value, /^(?:'(?:none|self|unsafe-inline|unsafe-eval)'|https?:\/\/[^\s;]+|data:|[a-z][a-z0-9+.-]*:)$/u, `${file}: unexpected CSP source "${value}" in "${directive.raw}"`);
      }
    }
  }
});

test("no directive swallowed the next one", () => {
  const names = new Set(PAGES.flatMap((file) => directivesOf(file)).map((directive) => directive.name));
  for (const file of PAGES) {
    for (const directive of directivesOf(file)) {
      // A merged directive shows up as another directive name appearing as one of its values.
      for (const other of names) {
        if (other === directive.name) continue;
        assert.ok(!directive.values.includes(other), `${file}: "${directive.raw}" contains the directive name "${other}" as a value, so a separator is missing`);
      }
    }
  }
});

test("font-src appears exactly once per page and only allows the local origin", () => {
  for (const file of PAGES) {
    const fontSrc = directivesOf(file).filter((directive) => directive.name === "font-src");
    assert.equal(fontSrc.length, 1, `${file}: expected exactly one font-src directive, found ${fontSrc.length}`);
    assert.deepEqual(fontSrc[0]?.values, ["'self'"], `${file}: font-src must allow only 'self', found "${fontSrc[0]?.raw ?? "MISSING"}"`);
  }
});

test("the baseline restrictions stay present on every page", () => {
  const baseline: [string, string][] = [["default-src", "'none'"], ["base-uri", "'none'"], ["form-action", "'none'"], ["style-src", "'self'"]];
  for (const file of PAGES) {
    const byName = new Map(directivesOf(file).map((directive) => [directive.name, directive]));
    for (const [name, expected] of baseline) {
      const directive = byName.get(name);
      assert.deepEqual(directive?.values, [expected], `${file}: ${name} must remain ${expected}, found "${directive?.raw ?? "MISSING"}"`);
    }
  }
});

test("no page allows a remote origin for any resource", () => {
  for (const file of PAGES) {
    for (const directive of directivesOf(file)) {
      for (const value of directive.values) {
        assert.ok(!/^https?:\/\//u.test(value), `${file}: ${directive.name} allows the remote origin ${value}`);
      }
    }
  }
});

test("the stylesheets reference bundled font files that really exist", () => {
  for (const css of ["proof/proof.css", "site.css"]) {
    const text = readFileSync(join(SITE, css), "utf8");
    // Each page resolves ./fonts/ against its own directory, so the files must ship there.
    const urls = [...text.matchAll(/url\("\.\/(fonts\/[^"]+\.woff2)"\)/gu)].map((match) => match[1] ?? "");
    assert.ok(urls.length >= 2, `${css}: expected both bundled font files to be referenced, found ${urls.length}`);
    for (const url of urls) {
      assert.match(url, /^fonts\/[a-z0-9.-]+\.woff2$/u, `${css}: unexpected font url ${url}`);
    }
  }
});

test("the source of truth for the fonts is present, licensed, and served to the studio", () => {
  for (const name of ["plex-sans-latin-var.woff2", "jetbrains-mono-latin-var.woff2"]) {
    const file = join(STUDIO_FONTS, name);
    assert.ok(existsSync(file), `bundled font ${name} is missing`);
    assert.equal(readFileSync(file).subarray(0, 4).toString("latin1"), "wOF2", `${name} is not a woff2 file`);
  }
  assert.ok(existsSync(join(STUDIO_FONTS, "licenses", "IBM-Plex-OFL.txt")), "IBM Plex OFL licence must ship beside the font");
  assert.ok(existsSync(join(STUDIO_FONTS, "licenses", "JetBrains-Mono-OFL.txt")), "JetBrains Mono OFL licence must ship beside the font");
  const server = readFileSync(join(REPO_ROOT, "src", "adapters", "studio", "studio-server.ts"), "utf8");
  for (const name of ["plex-sans-latin-var.woff2", "jetbrains-mono-latin-var.woff2"]) {
    assert.ok(server.includes(name), `studio-server.ts must serve ${name}`);
  }
});

test("the launch gate verifies that built pages really ship the fonts they request", () => {
  const gate = readFileSync(join(REPO_ROOT, "scripts", "launch-validate.mjs"), "utf8");
  assert.ok(gate.includes("woff2"), "launch-validate.mjs must check the built woff2 files, because HTML-only link checks never see CSS font urls");
  assert.ok(gate.includes("774f4632"), "launch-validate.mjs must confirm the built font is really a woff2 file");
  const builder = readFileSync(join(REPO_ROOT, "scripts", "build-site.mjs"), "utf8");
  for (const name of ["plex-sans-latin-var.woff2", "jetbrains-mono-latin-var.woff2", "site/proof/fonts"]) {
    assert.ok(builder.includes(name), `build-site.mjs must copy ${name} into the static site`);
  }
});

test("no page uses an inline style, which style-src 'self' would block", () => {
  for (const file of PAGES) {
    const text = readFileSync(join(SITE, file), "utf8");
    // An inline style attribute is not covered by a hash in CSP2 and is simply blocked,
    // which silently loses whatever it was expressing.
    assert.ok(!/\sstyle="/iu.test(text), `${file}: inline style attributes are blocked by style-src 'self'; use a class instead`);
    assert.ok(!/<style[\s>]/iu.test(text), `${file}: inline <style> elements are blocked by style-src 'self'`);
  }
});

test("the ruler fill is expressed as a width class that exists in the stylesheet", () => {
  const page = readFileSync(join(SITE, "proof", "index.html"), "utf8");
  const css = readFileSync(join(SITE, "proof", "proof.css"), "utf8");
  const used = [...page.matchAll(/<i class="(rf\d+)"><\/i>/gu)].map((match) => match[1] ?? "");
  assert.ok(used.length >= 2, `expected a ruler fill per case, found ${used.length}`);
  for (const name of used) {
    assert.match(name, /^rf(?:0|5|10|15|20|25|30|35|40|45|50|55|60|65|70|75|80|85|90|95|100)$/u, `${name} is not a defined width bucket`);
    assert.ok(css.includes(`.${name} {`), `proof.css must define .${name}`);
  }
});

test("the launch gate validates the font policy so a malformed directive cannot return", () => {
  const gate = readFileSync(join(REPO_ROOT, "scripts", "launch-validate.mjs"), "utf8");
  assert.ok(gate.includes("assertFontPolicy"), "launch-validate.mjs must enforce the font CSP policy");
  const policy = readFileSync(join(REPO_ROOT, "scripts", "csp-policy.mjs"), "utf8");
  assert.ok(policy.includes("separator is missing"), "the shared CSP policy must reject a merged directive");
});
