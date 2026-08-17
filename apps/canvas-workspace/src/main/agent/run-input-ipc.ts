import { ipcMain } from 'electron';

import type { ChatRunInputMode } from '../../shared/agent-chat';
import type { CanvasAgentService } from './service';
import type { ActiveChatRegistry } from './active-chat-registry';
import { submitChatRunInput } from './chat-protocol';

export function registerChatRunInputIpc(
  service: CanvasAgentService,
  activeChats: ActiveChatRegistry,
): void {
  ipcMain.handle('canvas-agent:run-input', (_event, payload: {
    sessionId: string;
    text: string;
    mode: ChatRunInputMode;
  }) => submitChatRunInput({ ...payload, activeChats, service }));
}
