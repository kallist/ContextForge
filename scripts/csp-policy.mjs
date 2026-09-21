// Shared CSP parsing for the public pages. A directive must be validated on its own:
// a missing separator merges two directives into one invalid directive, which browsers
// drop entirely -- silently losing the protections it was meant to keep.
export const cspMeta = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/iu;

/** Directives in written order, each with its value split into whitespace tokens. */
export function parseCsp(text) {
  const match = cspMeta.exec(text);
  if (!match?.[1]) throw new Error("Page must declare a Content-Security-Policy meta tag.");
  return match[1]
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((directive) => {
      const [name, ...values] = directive.split(/\s+/u);
      return { name: name ?? "", values, raw: directive };
    });
}

const SOURCE = /^(?:'(?:none|self|unsafe-inline|unsafe-eval)'|https?:\/\/[^\s;]+|data:|[a-z][a-z0-9+.-]*:)$/u;

/**
 * Throws when a directive is malformed, when one directive swallowed another,
 * or when a remote origin is allowed for any resource.
 */
export function assertCspWellFormed(label, text) {
  const directives = parseCsp(text);
  const names = new Set(directives.map((directive) => directive.name));
  for (const directive of directives) {
    if (!/^[a-z][a-z0-9-]*$/u.test(directive.name)) throw new Error(`${label}: invalid directive name in "${directive.raw}"`);
    for (const value of directive.values) {
      if (!SOURCE.test(value)) throw new Error(`${label}: unexpected CSP source "${value}" in "${directive.raw}"`);
      if (/^https?:\/\//u.test(value)) throw new Error(`${label}: ${directive.name} allows the remote origin ${value}`);
      if (names.has(value) && value !== directive.name) throw new Error(`${label}: "${directive.raw}" contains the directive name "${value}", so a separator is missing`);
    }
  }
  return directives;
}

/** Asserts the exact allow-list for the bundled fonts and the surviving baseline. */
export function assertFontPolicy(label, text) {
  const directives = assertCspWellFormed(label, text);
  const byName = new Map(directives.map((directive) => [directive.name, directive]));
  const fontSrc = directives.filter((directive) => directive.name === "font-src");
  if (fontSrc.length !== 1) throw new Error(`${label}: expected exactly one font-src directive, found ${fontSrc.length}`);
  if (fontSrc[0].values.join(" ") !== "'self'") throw new Error(`${label}: font-src must be exactly 'self', found "${fontSrc[0].raw}"`);
  for (const [name, expected] of [["default-src", "'none'"], ["base-uri", "'none'"], ["form-action", "'none'"], ["style-src", "'self'"]]) {
    const directive = byName.get(name);
    if (!directive || directive.values.join(" ") !== expected) throw new Error(`${label}: ${name} must remain ${expected}, found "${directive?.raw ?? "MISSING"}"`);
  }
  return directives;
}
