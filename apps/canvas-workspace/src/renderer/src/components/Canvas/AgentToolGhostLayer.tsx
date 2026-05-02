import { useEffect, useState } from 'react';
import type { CanvasNode } from '../../types';

/**
 * Default footprint per node type — mirrors `DEFAULT_DIMENSIONS` in
 * `apps/canvas-workspace/src/main/canvas-agent/tools.ts`. Kept in sync by
 * hand because the renderer can't import from main; if the tool defaults
 * drift this will look slightly off but won't break.
 */
const DEFAULT_DIMENSIONS: Record<string, { width: number; height: number }> = {
  file: { width: 420, height: 360 },
  terminal: { width: 480, height: 300 },
  frame: { width: 600, height: 400 },
  agent: { width: 520, height: 380 },
  text: { width: 260, height: 120 },
  iframe: { width: 520, height: 400 },
  shape: { width: 200, height: 140 },
  mindmap: { width: 640, height: 420 },
};

const RELATIVE_GAP = 40;

type RelativeSide = 'right' | 'left' | 'below' | 'above';

const TOOLS_WITH_GHOST = new Set([
  'canvas_create_node',
  'canvas_create_agent_node',
  'canvas_create_terminal_node',
  'canvas_create_shape',
]);

interface AgentToolCallDetail {
  workspaceId: string;
  toolCallId: number;
  name: string;
  args: Record<string, unknown> | undefined;
}

interface AgentToolResultDetail {
  workspaceId: string;
  toolCallId: number;
  name: string;
}

interface Ghost {
  toolCallId: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function dimensionsFor(name: string, args: Record<string, unknown> | undefined): { width: number; height: number } {
  if (name === 'canvas_create_terminal_node') return DEFAULT_DIMENSIONS.terminal;
  if (name === 'canvas_create_agent_node') return DEFAULT_DIMENSIONS.agent;
  if (name === 'canvas_create_shape') {
    const w = typeof args?.width === 'number' ? (args.width as number) : DEFAULT_DIMENSIONS.shape.width;
    const h = typeof args?.height === 'number' ? (args.height as number) : DEFAULT_DIMENSIONS.shape.height;
    return { width: w, height: h };
  }
  // canvas_create_node — pick by `type`
  const t = typeof args?.type === 'string' ? (args.type as string) : 'file';
  return DEFAULT_DIMENSIONS[t] ?? DEFAULT_DIMENSIONS.file;
}

/**
 * Resolve the planned drop position for a `canvas_create_*` call. Mirrors
 * (a subset of) the position logic in `tools.ts#canvas_create_node`:
 *
 *   1. explicit x/y on the args
 *   2. `relativeTo` + `side` against an existing node
 *   3. fallback: rightmost-existing-node + gap (the tool's `autoPlace`)
 *
 * Returns null when args don't have enough info AND there are no nodes to
 * anchor a fallback against — caller suppresses the ghost in that case.
 */
function resolvePosition(
  args: Record<string, unknown> | undefined,
  width: number,
  height: number,
  nodes: CanvasNode[],
): { x: number; y: number } | null {
  if (!args) return null;

  if (typeof args.x === 'number' && typeof args.y === 'number') {
    return { x: args.x as number, y: args.y as number };
  }

  const relativeTo = typeof args.relativeTo === 'string' ? (args.relativeTo as string) : undefined;
  const side = (typeof args.side === 'string' ? (args.side as RelativeSide) : 'right');
  if (relativeTo) {
    const anchor = nodes.find((n) => n.id === relativeTo);
    if (anchor) {
      switch (side) {
        case 'right': return { x: anchor.x + anchor.width + RELATIVE_GAP, y: anchor.y };
        case 'left': return { x: anchor.x - width - RELATIVE_GAP, y: anchor.y };
        case 'below': return { x: anchor.x, y: anchor.y + anchor.height + RELATIVE_GAP };
        case 'above': return { x: anchor.x, y: anchor.y - height - RELATIVE_GAP };
      }
    }
  }

  // autoPlace fallback — rightmost node + gap.
  if (nodes.length === 0) return { x: 100, y: 100 };
  let maxRight = 0;
  let bestY = 100;
  for (const n of nodes) {
    const right = n.x + n.width;
    if (right > maxRight) {
      maxRight = right;
      bestY = n.y;
    }
  }
  return { x: maxRight + RELATIVE_GAP, y: bestY };
}

/**
 * Subscribe to `canvas:agent-tool-call` / `canvas:agent-tool-result` events
 * dispatched from the chat stream, filter by workspace, and produce a
 * list of ghost rectangles representing in-flight `canvas_create_*` calls.
 *
 * Why events instead of prop drilling: the chat lives in a sibling
 * component tree (the side panel), and threading "active tool calls" down
 * to every Canvas instance would touch a half-dozen unrelated layers.
 * A window-level CustomEvent is enough — there's only ever one chat
 * panel running per workspace, the events are workspace-tagged, and the
 * payload is small.
 *
 * Ghosts auto-expire after 8 s as a safety net for tool calls that emit
 * `tool-call` but never `tool-result` (errors deep in the engine, aborts
 * that race the cleanup, etc.) so they can't pile up indefinitely.
 */
export function useAgentToolGhosts(workspaceId: string, nodes: CanvasNode[]): Ghost[] {
  const [ghosts, setGhosts] = useState<Ghost[]>([]);

  useEffect(() => {
    const onCall = (event: Event) => {
      const detail = (event as CustomEvent<AgentToolCallDetail>).detail;
      if (!detail || detail.workspaceId !== workspaceId) return;
      if (!TOOLS_WITH_GHOST.has(detail.name)) return;
      const { width, height } = dimensionsFor(detail.name, detail.args);
      const pos = resolvePosition(detail.args, width, height, nodes);
      if (!pos) return;
      setGhosts((prev) => [
        ...prev.filter((g) => g.toolCallId !== detail.toolCallId),
        { toolCallId: detail.toolCallId, name: detail.name, x: pos.x, y: pos.y, width, height },
      ]);
    };
    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<AgentToolResultDetail>).detail;
      if (!detail || detail.workspaceId !== workspaceId) return;
      setGhosts((prev) => prev.filter((g) => g.toolCallId !== detail.toolCallId));
    };

    window.addEventListener('canvas:agent-tool-call', onCall);
    window.addEventListener('canvas:agent-tool-result', onResult);
    return () => {
      window.removeEventListener('canvas:agent-tool-call', onCall);
      window.removeEventListener('canvas:agent-tool-result', onResult);
    };
  }, [workspaceId, nodes]);

  // Safety net — purge anything older than 8 seconds, in case a tool-call
  // event arrives without a matching tool-result (engine error, abort).
  useEffect(() => {
    if (ghosts.length === 0) return;
    const t = setTimeout(() => {
      setGhosts((prev) => prev.slice(-3)); // keep at most the 3 most recent
    }, 8000);
    return () => clearTimeout(t);
  }, [ghosts]);

  return ghosts;
}

export const AgentToolGhostLayer = ({ ghosts }: { ghosts: Ghost[] }) => {
  if (ghosts.length === 0) return null;
  return (
    <>
      {ghosts.map((g) => (
        <div
          key={g.toolCallId}
          className="agent-tool-ghost"
          style={{
            transform: `translate(${g.x}px, ${g.y}px)`,
            width: g.width,
            height: g.height,
          }}
        >
          <div className="agent-tool-ghost-pulse" />
          <div className="agent-tool-ghost-label">creating…</div>
        </div>
      ))}
    </>
  );
};
