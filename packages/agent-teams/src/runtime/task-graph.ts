export interface TaskGraphNode {
  id: string;
  title?: string;
  deps?: readonly string[];
}

const formatNodeLabel = (node: TaskGraphNode | undefined, id: string): string =>
  node?.title ? `${node.title} (${id})` : id;

export function findTaskGraphCycle(nodes: readonly TaskGraphNode[]): string[] | null {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      return [...stack.slice(start), id];
    }
    if (visited.has(id)) return null;

    const node = byId.get(id);
    if (!node) return null;

    visiting.add(id);
    stack.push(id);

    for (const depId of node.deps ?? []) {
      if (!byId.has(depId)) continue;
      const cycle = visit(depId);
      if (cycle) return cycle;
    }

    stack.pop();
    visiting.delete(id);
    visited.add(id);
    return null;
  };

  for (const node of nodes) {
    const cycle = visit(node.id);
    if (cycle) {
      return cycle.map((id) => formatNodeLabel(byId.get(id), id));
    }
  }
  return null;
}

export function assertTaskGraphAcyclic(nodes: readonly TaskGraphNode[]): void {
  const cycle = findTaskGraphCycle(nodes);
  if (cycle) {
    throw new Error(`Task dependency cycle detected: ${cycle.join(' -> ')}`);
  }
}

export function computeTopologicalRounds(nodes: readonly TaskGraphNode[]): Map<string, number> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const cache = new Map<string, number>();

  const depth = (id: string, seen: Set<string>): number => {
    if (cache.has(id)) return cache.get(id)!;
    if (seen.has(id)) return 1;
    const node = byId.get(id);
    if (!node?.deps?.length) { cache.set(id, 1); return 1; }
    seen.add(id);
    const maxDep = Math.max(...node.deps.filter((d) => byId.has(d)).map((d) => depth(d, new Set(seen))));
    const result = (maxDep > 0 ? maxDep : 0) + 1;
    cache.set(id, result);
    return result;
  };

  for (const node of nodes) depth(node.id, new Set());
  return cache;
}
