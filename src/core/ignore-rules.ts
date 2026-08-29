import ignore, { type Ignore } from "ignore";

export interface IgnoreLayer {
  readonly basePath: string;
  readonly matcher: Ignore;
}

export function createIgnoreLayer(basePath: string, rules: string): IgnoreLayer {
  return { basePath, matcher: ignore().add(rules) };
}

export function isIgnoredByLayers(layers: readonly IgnoreLayer[], path: string, directory: boolean): boolean {
  let ignored = false;
  for (const layer of layers) {
    if (layer.basePath !== "" && path !== layer.basePath && !path.startsWith(`${layer.basePath}/`)) continue;
    const localPath = layer.basePath === "" ? path : path.slice(layer.basePath.length + 1);
    if (localPath === "") continue;
    const result = layer.matcher.test(directory ? `${localPath}/` : localPath);
    if (result.ignored) ignored = true;
    if (result.unignored) ignored = false;
  }
  return ignored;
}
