import type { CanvasWorkspaceApi } from './types/workspace-api';

export type * from './types/agent-chat';
export type * from './types/agent-teams';
export type * from './types/app-info';
export type * from './types/auth';
export type * from './types/artifacts';
export type * from './types/canvas';
export type * from './types/channel-config';
export type * from './types/codex-sessions';
export type * from './types/default-browser';
export type * from './types/experimental';
export type * from './types/files';
export type * from './types/iframe';
export type * from './types/knowledge';
export type * from './types/link';
export type * from './types/llm';
export type * from './types/models';
export type * from './types/settings-config';
export type * from './types/shell';
export type * from './types/web';
export type * from './types/workspace-api';

declare global {
  interface Window {
    canvasWorkspace: CanvasWorkspaceApi;
  }
}
