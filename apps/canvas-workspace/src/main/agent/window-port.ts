import type { BrowserWindow } from 'electron';

export interface CanvasWindowPort {
  /** The focused window when there is one, else the registered live Canvas window. */
  getFocusedCanvasWindow: () => BrowserWindow | null;
  /** The registered live Canvas window, without focusing, showing, or creating it. */
  getLiveCanvasWindow: () => BrowserWindow | null;
  activateWorkspaceWindow: (
    workspaceId: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}

const unavailableWindowPort: CanvasWindowPort = {
  getFocusedCanvasWindow: () => null,
  getLiveCanvasWindow: () => null,
  activateWorkspaceWindow: async () => ({
    ok: false,
    error: 'Canvas window integration is unavailable.',
  }),
};

let windowPort = unavailableWindowPort;

/**
 * Injected by the app composition root so Agent tools and runtime
 * capabilities never depend on app internals.
 */
export function setCanvasWindowPort(port: CanvasWindowPort): void {
  windowPort = port;
}

export function getCanvasWindowPort(): CanvasWindowPort {
  return windowPort;
}
