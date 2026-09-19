export type DiskReadOutcome<Node, Edge> =
  | { kind: 'ok'; nodes: Node[]; edges: Edge[] }
  | { kind: 'missing' }
  | { kind: 'unparseable'; err: unknown }
  | { kind: 'ioerror'; err: unknown };

/** Legacy file readers may observe a concurrent external replacement; retry boundedly. */
export async function readCanvasForMerge<Node, Edge>(
  read: () => Promise<{ data: { nodes?: unknown[]; edges?: unknown[] } | null }>,
  attempts = 3,
  delayMs = 30,
): Promise<DiskReadOutcome<Node, Edge>> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const result = await read();
      if (result.data === null) return { kind: 'missing' };
      return {
        kind: 'ok',
        nodes: Array.isArray(result.data.nodes) ? result.data.nodes as Node[] : [],
        edges: Array.isArray(result.data.edges) ? result.data.edges as Edge[] : [],
      };
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  return { kind: 'unparseable', err: lastError };
}
