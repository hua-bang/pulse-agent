/**
 * Sets a canvas's node selection from outside the canvas, for example a
 * Shift+click in the Layers panel. Only the canvas of `workspaceId` acts on
 * it. A window event, like the other shell-to-canvas requests, so the
 * sidebar needs no handle on the canvas.
 */
export const SELECT_CANVAS_NODES_EVENT = 'pulse:select-canvas-nodes';

export interface SelectCanvasNodesDetail {
  workspaceId: string;
  nodeIds: string[];
}

export const requestCanvasSelection = (workspaceId: string, nodeIds: string[]): void => {
  window.dispatchEvent(new CustomEvent<SelectCanvasNodesDetail>(SELECT_CANVAS_NODES_EVENT, {
    detail: { workspaceId, nodeIds },
  }));
};
