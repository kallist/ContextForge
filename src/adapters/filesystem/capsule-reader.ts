import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { MAX_CAPSULE_BYTES, parseCapsule, type ContextCapsuleV1 } from "../../core/context-capsule.js";
import { ContextForgeError } from "../../core/errors.js";

export async function readCapsule(path: string): Promise<ContextCapsuleV1> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK).catch(() => { throw new ContextForgeError("INVALID_CAPSULE", "Unable to open Context Capsule."); });
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_CAPSULE_BYTES) throw new ContextForgeError("INVALID_CAPSULE", "Capsule must be a regular file no larger than 8 MiB.");
    // A bounded handle read also protects against the file growing after stat.
    const buffer = Buffer.alloc(Math.min(stat.size + 1, MAX_CAPSULE_BYTES + 1));
    let read = 0;
    while (read < buffer.length) {
      const chunk = await handle.read(buffer, read, buffer.length - read, read);
      if (chunk.bytesRead === 0) break;
      read += chunk.bytesRead;
    }
    if (read > stat.size) throw new ContextForgeError("INVALID_CAPSULE", "Capsule changed while reading.");
    let json: string;
    try { json = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, read)); }
    catch { throw new ContextForgeError("INVALID_CAPSULE", "Capsule is not valid UTF-8."); }
    return parseCapsule(json);
  } finally { await handle.close(); }
}
