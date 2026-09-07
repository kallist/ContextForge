import assert from "node:assert/strict";
import test from "node:test";
import { ABSOLUTE_PATH_PLACEHOLDER as replacement, CAPSULE_TEXT_LIMIT, hasAbsolutePath, redactAbsolutePaths } from "../../src/core/capsule-privacy.js";

const paths = ["/home/alice/project", "/Users/alice/project", "/tmp/foo", "/var/lib/app", "C:\\Users\\alice\\project", "C:/Users/alice/project", "D:\\repo\\src\\a.ts", "\\\\server\\share\\repo", "file:///home/alice/project", "file:///C:/Users/alice/project"];
for (const path of paths) test(`Capsule redaction path class ${paths.indexOf(path) + 1}: delimiters and repetitions`, () => {
  for (const [prefix, suffix] of [["", ""], ["path=", ""], ["path: ", ""], ['"cwd": "', '"'], ["open(", ")"], ["[", "]"], ["{", "}"], ["prose,", ""], ["repo ", ""], ["key:", ""]]) {
    const text = prefix + path + suffix;
    assert.equal(redactAbsolutePaths(text), prefix + replacement + suffix);
    assert.equal(hasAbsolutePath(text), true);
  }
  const text = `compare ${path} with ${path}`;
  assert.equal(redactAbsolutePaths(text), `compare ${replacement} with ${replacement}`);
  assert.equal(hasAbsolutePath(redactAbsolutePaths(text)), false);
});

test("Capsule redaction preserves relative paths, web URLs, division, prose and placeholders", () => {
  for (const text of ["src/index.ts", "../relative/path", "./local/path", "https://example.com/docs", "https://example.com/home/alice", "http://example.com/a", "1/2", "a/b", "a / b", "x /= 2", "ordinary prose", replacement, `already ${replacement} and src/a.ts`]) {
    assert.equal(redactAbsolutePaths(text), text);
    assert.equal(hasAbsolutePath(text), false);
  }
  assert.equal(redactAbsolutePaths("compare src/a.ts with /home/alice/project/src/a.ts and https://example.com/a"), `compare src/a.ts with ${replacement} and https://example.com/a`);
  assert.equal(redactAbsolutePaths('"https://example.com/a and /tmp/private"'), `"https://example.com/a and ${replacement}"`);
  assert.equal(redactAbsolutePaths("compare /home/alice/a with C:\\Users\\bob\\b"), `compare ${replacement} with ${replacement}`);
});

test("Capsule redaction handles quoted spaces, multiple platform forms and repeated serialization", () => {
  const text = 'root="D:\\Users\\Alice Smith\\repo"; cwd="/home/First Last/repo"';
  const expected = `root="${replacement}"; cwd="${replacement}"`;
  assert.equal(redactAbsolutePaths(text), expected);
  assert.equal(redactAbsolutePaths(expected), expected);
  assert.equal(redactAbsolutePaths(JSON.parse(JSON.stringify(expected)) as string), expected);
  assert.equal(redactAbsolutePaths("path=//server/share/repo"), `path=${replacement}`);
});

test("Capsule redaction is bounded on maximum-length adversarial text", () => {
  const text = "a/".repeat(CAPSULE_TEXT_LIMIT / 2);
  assert.equal(redactAbsolutePaths(text), text);
  const repeated = "/tmp/a ".repeat(Math.floor(CAPSULE_TEXT_LIMIT / 7));
  assert.equal(redactAbsolutePaths(repeated), replacement);
  assert.equal(redactAbsolutePaths("/a /b", 20), replacement);
});
