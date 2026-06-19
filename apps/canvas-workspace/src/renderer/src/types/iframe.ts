import type { AgentContextDomSelectionRef } from './agent-chat';

export interface IframeApi {
  registerWebview: (
    workspaceId: string,
    nodeId: string,
    webContentsId: number,
  ) => Promise<{ ok: boolean }>;
  unregisterWebview: (
    workspaceId: string,
    nodeId: string,
  ) => Promise<{ ok: boolean }>;
  /**
   * Drop or restore a registered webview's max paint frame rate. Used to
   * throttle webview nodes that have left the canvas viewport — the guest
   * process stays alive and JS/timers/network keep running at full speed,
   * only paint cadence drops so we save GPU work and tile memory without
   * losing any in-page state. Frame rate is clamped to [1, 240] in main.
   */
  setFrameRate: (
    workspaceId: string,
    nodeId: string,
    frameRate: number,
  ) => Promise<{ ok: boolean; frameRate?: number }>;
  pickDomElement: (
    workspaceId: string,
    nodeId: string,
  ) => Promise<{
    ok: boolean;
    selection?: AgentContextDomSelectionRef;
    error?: string;
    cancelled?: boolean;
  }>;
  cancelDomElementPick: (
    workspaceId: string,
    nodeId: string,
  ) => Promise<{
    ok: boolean;
    error?: string;
  }>;
}
