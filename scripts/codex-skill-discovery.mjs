import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Public local app-server protocol, without a model turn or user-config changes.
export async function verifyCodexDiscovery(executable, cwd, expectedText) {
  const child = spawn(executable, ["app-server", "--stdio"], { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map();
  let buffer = "", sequence = 0;
  child.stderr.resume();
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  });
  const request = (method, params) => new Promise((yes, no) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); no(new Error("Codex request timed out: " + method)); }, 20000);
    pending.set(id, (message) => { clearTimeout(timeout); if (message.error) no(new Error(JSON.stringify(message.error))); else yes(message.result); });
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
  try {
    await request("initialize", { clientInfo: { name: "contextforge-skill-acceptance", version: "0.5.0" } });
    child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
    const result = await request("skills/list", { cwds: [cwd], forceReload: true });
    const found = result.data.flatMap((entry) => entry.skills).filter((skill) => skill.name === "contextforge" && resolve(skill.path).startsWith(cwd));
    assert.equal(found.length, 1);
    assert.equal(found[0].enabled, true);
    assert.ok(found[0].description.includes("repository context"));
    assert.equal(await readFile(found[0].path, "utf8"), expectedText);
    return "PASS: Codex app-server skills/list";
  } finally {
    child.kill();
    await new Promise((done) => { if (child.exitCode !== null) done(); else child.once("exit", done); });
  }
}
