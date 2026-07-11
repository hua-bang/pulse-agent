import type { BrowserWindow } from 'electron';
import { setupCanvasAgentTeamsIpc } from './ipc';
import { setupAgentTeamPtyBridge } from './pty-bridge';
import { getCanvasAgentTeamsService } from './service';

export const setupAgentTeamsRuntime = (
  getWindows: () => BrowserWindow[],
  log: (message: string, detail?: string) => void,
): void => {
  setupCanvasAgentTeamsIpc();
  setupAgentTeamPtyBridge(log);
  const service = getCanvasAgentTeamsService();
  service.hasOpenWindows = () => getWindows().length > 0;
  service.startHeartbeat();
};
