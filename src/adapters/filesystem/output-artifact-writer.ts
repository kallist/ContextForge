import { open, link, lstat, stat, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import type { OutputArtifactWriter } from "../../application/output-artifact.js";
import { ContextForgeError } from "../../core/errors.js";

let temporarySequence = 0;
type PublishArtifact = (temporaryPath: string, targetPath: string) => Promise<void>;

function errorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
}

export class FileSystemOutputArtifactWriter implements OutputArtifactWriter {
  readonly #publish: PublishArtifact;

  constructor(publish: PublishArtifact = link) {
    this.#publish = publish;
  }

  async writeExclusive(outputPath: string, content: string): Promise<void> {
    const target = resolve(outputPath);
    const parent = dirname(target);
    try {
      const parentMetadata = await stat(parent);
      if (!parentMetadata.isDirectory()) throw new ContextForgeError("OUTPUT_WRITE_FAILED", "Output parent is not a directory.");
    } catch (error) {
      if (error instanceof ContextForgeError) throw error;
      throw new ContextForgeError("OUTPUT_WRITE_FAILED", "Output parent directory does not exist or is inaccessible.", { cause: error });
    }
    try {
      await lstat(target);
      throw new ContextForgeError("OUTPUT_EXISTS", "Refusing to overwrite an existing output path.");
    } catch (error) {
      if (error instanceof ContextForgeError) throw error;
      if (errorCode(error) !== "ENOENT") {
        throw new ContextForgeError("OUTPUT_WRITE_FAILED", "Cannot inspect the output target safely.", { cause: error });
      }
    }

    temporarySequence += 1;
    const temporary = join(parent, `.${basename(target)}.contextforge-${process.pid}-${temporarySequence}.tmp`);
    let temporaryCreated = false;
    try {
      const handle = await open(temporary, "wx", 0o600);
      temporaryCreated = true;
      try {
        await handle.writeFile(content, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await this.#publish(temporary, target);
      } catch (error) {
        if (errorCode(error) === "EEXIST") {
          throw new ContextForgeError("OUTPUT_EXISTS", "Refusing to overwrite an output path created concurrently.", { cause: error });
        }
        throw new ContextForgeError("OUTPUT_WRITE_FAILED", "Could not publish the completed output artifact.", { cause: error });
      }
    } catch (error) {
      if (error instanceof ContextForgeError) throw error;
      throw new ContextForgeError("OUTPUT_WRITE_FAILED", "Could not write the output artifact.", { cause: error });
    } finally {
      if (temporaryCreated) {
        try {
          await unlink(temporary);
        } catch {
          // A best-effort cleanup failure must not remove or corrupt a published final artifact.
        }
      }
    }
  }
}
