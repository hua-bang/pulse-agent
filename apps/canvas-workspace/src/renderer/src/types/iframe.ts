import type { AgentContextDomSelectionRef } from './agent-chat';

export interface IframeApi {
  registerWebview: (
    workspaceId: string,
    nodeId: string,
    webContentsId: number,
    ready?: boolean,
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
  /**
   * Chrome-style freeze/resume for a registered webview (DevTools protocol
   * Page.setWebLifecycleState — the mechanism Chrome uses on background
   * tabs). 'frozen' suspends the page's task queues (JS/timers/network)
   * while keeping the process and memory intact; 'active' resumes
   * instantly with no reload. Freezing is refused for audible pages and
   * pages with DevTools open (`skipped`), mirroring Chrome's exemptions.
   */
  setLifecycle: (
    workspaceId: string,
    nodeId: string,
    state: 'active' | 'frozen',
  ) => Promise<{
    ok: boolean;
    state?: 'active' | 'frozen';
    skipped?: 'destroyed' | 'audible' | 'devtools';
    error?: string;
  }>;
  /**
   * Fired by main's L3 discard monitor (Memory Saver style) when total
   * guest memory exceeds budget and this node's long-frozen webview was
   * chosen for discard. The renderer unmounts the `<webview>` (killing the
   * guest process) and shows the snapshot as a sleeping placeholder;
   * dwelling in the viewport or clicking wakes and reloads the page.
   */
  onDiscarded: (
    callback: (payload: {
      workspaceId: string;
      nodeId: string;
      snapshotDataUrl?: string;
    }) => void,
  ) => () => void;
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
