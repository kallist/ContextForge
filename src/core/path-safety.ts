import { isAbsolute, relative, sep } from "node:path";

export function isWithinRoot(rootRealPath: string, candidateRealPath: string): boolean {
  const difference = relative(rootRealPath, candidateRealPath);
  return difference === "" || (!isAbsolute(difference) && difference !== ".." && !difference.startsWith(`..${sep}`));
}

export function normalizeRelativePath(path: string): string {
  return path.split(sep).join("/");
}
