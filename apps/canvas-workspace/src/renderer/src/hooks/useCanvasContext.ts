import type { CanvasNode } from '../types';

export const useCanvasContext = (rootFolder: string | undefined, nodes: CanvasNode[], canvasName?: string) => {
  // Intentionally a no-op for now.
  //
  // The previous implementation silently wrote a Pulse-Canvas marker
  // block into `<rootFolder>/CLAUDE.md` and `<rootFolder>/AGENTS.md`
  // (debounced) on every canvas change, so external coding agents
  // (Claude Code / Codex / Cursor) opening the repo would auto-discover
  // the workspace. The user has opted out of touching project files —
  // workspace context now lives only in `pulse-workspace.md`, which the
  // user explicitly creates from the settings drawer.
  //
  // The hook + signature are kept so re-enabling is one effect away.
  void rootFolder; void nodes; void canvasName;
};
