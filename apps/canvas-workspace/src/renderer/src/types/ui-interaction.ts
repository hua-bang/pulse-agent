import type { CanvasNode } from '../types';

export type ToastTone = 'success' | 'error' | 'loading' | 'info';

/** Optional inline button rendered alongside the toast body. The toast
 *  is dismissed automatically when the action fires so callers don't
 *  need to thread the dismiss id through to the handler. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastInput {
  tone: ToastTone;
  title: string;
  description?: string;
  autoCloseMs?: number;
  action?: ToastAction;
}

export interface ToastRecord extends ToastInput {
  id: string;
  createdAt: number;
}

export type ConfirmIntent = 'default' | 'danger';

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  intent?: ConfirmIntent;
}

export interface CanvasNodeRenameRequest {
  workspaceId: string;
  nodeId: string;
  title: string;
}

export interface CanvasNodePatchRequest {
  workspaceId: string;
  nodeId: string;
  patch: Partial<CanvasNode>;
  requestId: number;
}

export interface CanvasClipboard {
  sourceWorkspaceId: string;
  nodes: CanvasNode[];
  /**
   * Exactly what the canvas copy wrote into the SYSTEM clipboard. The paste
   * path compares it against the incoming clipboard text to decide which
   * clipboard is newer: still equal → the node copy is the most recent thing
   * the user copied and wins; changed → they copied something elsewhere
   * since, and that content wins. Optional because a copy can fail to reach
   * the system clipboard (permissions), in which case the nodes still paste.
   */
  systemText?: string;
}
