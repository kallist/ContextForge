import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

export async function createTemporaryDirectory(label: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `contextforge-${label}-`));
}

export async function writeFixture(root: string, relativePath: string, content: string | Uint8Array): Promise<void> {
  const destination = join(root, ...relativePath.split("/"));
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

export async function removeTemporaryDirectory(path: string): Promise<void> {
  await rm(path, { force: true, recursive: true });
}
