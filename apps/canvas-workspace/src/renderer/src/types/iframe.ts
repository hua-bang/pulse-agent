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
  pickDomElement: (
    workspaceId: string,
    nodeId: string,
  ) => Promise<{
    ok: boolean;
    selection?: AgentContextDomSelectionRef;
    error?: string;
    cancelled?: boolean;
  }>;
}
