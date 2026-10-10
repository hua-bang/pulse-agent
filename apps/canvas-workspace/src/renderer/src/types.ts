import type { CanvasWorkspaceApi } from '../../shared/api/workspace-api';

export type * from '../../shared/agent-roles';
export type * from '../../shared/browsing-history';
export type * from '../../shared/scheduled';
export type * from '../../shared/api/agent-chat';
export type * from '../../shared/api/agent-teams';
export type * from '../../shared/api/app-info';
export type * from '../../shared/api/artifacts';
export type * from '../../shared/api/canvas';
export type * from '../../shared/api/channel-config';
export type * from '../../shared/api/codex-sessions';
export type * from '../../shared/api/default-browser';
export type * from '../../shared/api/dock';
export type * from '../../shared/api/experimental';
export type * from '../../shared/api/files';
export type * from '../../shared/api/iframe';
export type * from '../../shared/api/knowledge';
export type * from '../../shared/api/link';
export type * from '../../shared/api/llm';
export type * from '../../shared/api/models';
export type * from '../../shared/api/settings-config';
export type * from '../../shared/api/shell';
export type * from '../../shared/api/web';
export type * from '../../shared/api/workspace-api';

declare global {
  interface Window {
    canvasWorkspace: CanvasWorkspaceApi;
  }
}
