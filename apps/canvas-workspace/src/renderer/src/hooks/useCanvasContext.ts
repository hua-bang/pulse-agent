import type { CanvasNode } from '../types';

export const useCanvasContext = (rootFolder: string | undefined, nodes: CanvasNode[], canvasName?: string) => {
  // Intentionally a no-op for now.
  //
  // Previously this hook ran on every canvas change (debounced 1.5s) and
  // silently upserted a project-structure + canvas-files block into
  // `<rootFolder>/CLAUDE.md` and `<rootFolder>/AGENTS.md` as soon as a
  // root folder was set. That meant any workspace with a root folder
  // would keep modifying git-tracked project files on its own, which is
  // surprising — the user did not opt in to "Pulse Canvas writes to my
  // project's docs."
  //
  // Coding agents now read Pulse Canvas through the installed `pulse-canvas`
  // skill + CLI instead of repository instruction-file bridges. Terminals are
  // spawned with PULSE_CANVAS_WORKSPACE_ID, so `pulse-canvas context --format json`
  // resolves the active canvas without modifying project files.
  //
  // The hook + signature are kept so re-enabling later (e.g. behind a
  // workspace setting) is one effect away.
  void rootFolder; void nodes; void canvasName;
};
