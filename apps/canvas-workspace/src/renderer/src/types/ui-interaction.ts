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

export interface ShortcutItem {
  combo: string;
  description: string;
}

export interface ShortcutSection {
  title: string;
  items: ShortcutItem[];
}

export interface CanvasNodeRenameRequest {
  workspaceId: string;
  nodeId: string;
  title: string;
}
