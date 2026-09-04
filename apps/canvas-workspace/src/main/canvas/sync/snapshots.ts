export function itemsToMap<T extends { id?: string }>(items: T[] | undefined): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items ?? []) {
    if (item.id) result.set(item.id, item);
  }
  return result;
}

export function diffSnapshots<T extends { updatedAt?: number }>(
  before: Map<string, T>,
  after: Map<string, T>,
): string[] {
  const ids = new Set<string>();
  for (const [id, item] of after) {
    const previous = before.get(id);
    if (!previous) {
      ids.add(id);
      continue;
    }
    if ((previous.updatedAt ?? 0) !== (item.updatedAt ?? 0)) {
      ids.add(id);
    } else if (JSON.stringify(previous) !== JSON.stringify(item)) {
      ids.add(id);
    }
  }
  for (const id of before.keys()) {
    if (!after.has(id)) ids.add(id);
  }
  return Array.from(ids);
}

export function visibleNodeFieldsChanged(previousRaw: string, nextRaw: string): boolean {
  type PerNodeShape = { data?: unknown; type?: unknown; title?: unknown };
  let previous: PerNodeShape;
  let next: PerNodeShape;
  try {
    previous = JSON.parse(previousRaw) as PerNodeShape;
    next = JSON.parse(nextRaw) as PerNodeShape;
  } catch {
    return true;
  }
  if (previous.type !== next.type) return true;
  if (previous.title !== next.title) return true;
  return stableStringify(previous.data) !== stableStringify(next.data);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  const parts = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${parts.join(',')}}`;
}
