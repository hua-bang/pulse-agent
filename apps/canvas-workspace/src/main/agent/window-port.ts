import type { BrowserWindow } from 'electron';

export interface AgentWindowPort {
  getCanvasWindow: () => BrowserWindow | null;
  activateWorkspaceWindow: (
    workspaceId: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}

const unavailableWindowPort: AgentWindowPort = {
  getCanvasWindow: () => null,
  activateWorkspaceWindow: async () => ({
    ok: false,
    error: 'Canvas window integration is unavailable.',
  }),
};

let windowPort = unavailableWindowPort;

/** Injected by the app composition root so Agent tools never depend on app internals. */
export function setAgentWindowPort(port: AgentWindowPort): void {
  windowPort = port;
}

export function getAgentWindowPort(): AgentWindowPort {
  return windowPort;
}
