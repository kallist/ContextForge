/** One platform-independent lexical policy for persisted Capsule/Explain text. */
export const ABSOLUTE_PATH_PLACEHOLDER = "<ABSOLUTE_PATH>";
export const CAPSULE_TEXT_LIMIT = 16_384;

const boundary = (character: string): boolean => character === "" || /[\s=:()[\]{},;"'`<>!?|]/u.test(character);
const stop = (character: string): boolean => /[\s"'`()[\]{},;<>|]/u.test(character);
const letter = (character: string): boolean => /^[a-z]$/iu.test(character);

/**
 * Linear scan: each URL/path span is consumed once. Absolute POSIX lexemes need
 * a delimiter/start boundary, preserving relative paths and ordinary division.
 * HTTP(S) URLs are opaque web addresses. Local file URLs are always redacted.
 * Quoted paths include whitespace up to the matching quote; unquoted paths end
 * at a text delimiter. This is lexical redaction, not filesystem resolution.
 */
export function redactAbsolutePaths(text: string, limit = CAPSULE_TEXT_LIMIT): string {
  const pieces: string[] = [];
  let copied = 0, index = 0;
  while (index < text.length) {
    const before = text[index - 1] ?? "", character = text[index] ?? "";
    const prefix = text.slice(index, index + 8).toLowerCase();
    const web = boundary(before) && (prefix.startsWith("https://") || prefix.startsWith("http://"));
    const file = boundary(before) && prefix.startsWith("file:") && /[\\/]/u.test(text[index + 5] ?? "");
    const drive = boundary(before) && letter(character) && text[index + 1] === ":" && /[\\/]/u.test(text[index + 2] ?? "");
    const unc = text.startsWith("\\\\", index);
    const posix = character === "/" && boundary(before) && !stop(text[index + 1] ?? " ") && text[index + 1] !== "=";
    if (!web && !file && !drive && !unc && !posix) { index++; continue; }
    let end = index + 1;
    const quote = !web && ["\"", "'", "`"].includes(before) ? before : null;
    while (end < text.length && (quote === null ? !stop(text[end] ?? "") : text[end] !== quote && !/[\r\n]/u.test(text[end] ?? ""))) end++;
    if (web) { index = end; continue; }
    pieces.push(text.slice(copied, index), ABSOLUTE_PATH_PLACEHOLDER);
    copied = end;
    index = end;
  }
  if (copied === 0) return text;
  const redacted = pieces.join("") + text.slice(copied);
  // Many short paths can expand beyond the existing field bound. Omit the whole
  // display in that case, never the original task or the compiler's input.
  return redacted.length <= limit ? redacted : ABSOLUTE_PATH_PLACEHOLDER;
}

export function hasAbsolutePath(text: string): boolean {
  return redactAbsolutePaths(text) !== text;
}
