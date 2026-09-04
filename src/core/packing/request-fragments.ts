import { renderContextItem, type RenderableContextItem } from "../context-serialization.js";

/** Internal request-local cache. Keys are immutable, generation-verified item objects.
 * Callers create a distinct object for every file/range/metadata combination.
 * Capacity affects recomputation only, never the serialized result or selection.
 */
export function createRequestFragmentRenderer() {
  const fragments = new WeakMap<RenderableContextItem, string>();
  const counters = { hits: 0, renders: 0, entries: 0, characters: 0 };
  const render = (item: RenderableContextItem): string => {
    const cached = fragments.get(item);
    if (cached !== undefined) { counters.hits += 1; return cached; }
    const value = renderContextItem(item);
    counters.renders += 1;
    // At most 2 MiB of UTF-16 fragment characters, plus bounded object overhead.
    if (counters.entries < 321 && counters.characters + value.length <= 1_048_576) {
      fragments.set(item, value);
      counters.entries += 1;
      counters.characters += value.length;
    }
    return value;
  };
  return { render, counters };
}
