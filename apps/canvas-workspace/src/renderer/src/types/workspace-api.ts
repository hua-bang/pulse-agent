import type { PluginBridge } from '../../../plugins/types';
import type {
  CanvasSaveData,
  KnowledgeTagDefinition,
  WorkspaceNodeListItem,
  WorkspaceNodeRecord,
} from '../../../shared/canvas';
import type { AgentApi } from './agent-chat';
import type { AgentTeamsApi } from './agent-teams';
import type { AppInfoApi } from './app-info';
import type { ArtifactsApi } from './artifacts';
import type { CanvasModelApi, PromptProfileApi } from './models';
import type {
  CanvasMcpApi,
  CanvasPluginsApi,
  CanvasSkillsApi,
  BuiltInToolsConfigApi,
  SkillsApi,
} from './settings-config';
import type { ChannelConfigApi } from './channel-config';
import type { CodexSessionsApi } from './codex-sessions';
import type { DialogApi, FileApi } from './files';
import type { ExperimentalApi } from './experimental';
import type { IframeApi } from './iframe';
import type { LinkApi } from './link';
import type { LlmApi } from './llm';
import type { ShellApi } from './shell';
import type { WebApi } from './web';

export interface CanvasWorkspaceApi {
  version: string;
  appInfo: AppInfoApi;
  pluginFlags: Record<string, boolean>;
  pty: {
    spawn: (
      id: string,
      cols?: number,
      rows?: number,
      cwd?: string,
      workspaceId?: string,
      env?: Record<string, string | undefined>,
    ) => Promise<{ ok: boolean; pid?: number; error?: string; reused?: boolean }>;
    write: (id: string, data: string) => void;
    resize: (id: string, cols: number, rows: number) => void;
    kill: (id: string) => void;
    getCwd: (id: string) => Promise<{ ok: boolean; cwd?: string | null }>;
    checkCommand: (command: string) => Promise<{ ok: boolean; available: boolean; path?: string; error?: string }>;
    onData: (id: string, callback: (data: string) => void) => () => void;
    onExit: (id: string, callback: (exitCode: number) => void) => () => void;
  };
  store: {
    save: (
      id: string,
      data: unknown,
    ) => Promise<{ ok: boolean; error?: string }>;
    load: (
      id: string,
    ) => Promise<{ ok: boolean; data?: CanvasSaveData | null; error?: string }>;
    list: () => Promise<{ ok: boolean; ids?: string[]; error?: string }>;
    delete: (id: string) => Promise<{ ok: boolean; error?: string }>;
    getDir: (id: string) => Promise<{ ok: boolean; dir?: string; error?: string }>;
    exportWorkspace: (
      id: string,
      name: string,
    ) => Promise<{
      ok: boolean;
      canceled?: boolean;
      filePath?: string;
      fileCount?: number;
      externalFileCount?: number;
      skippedExternalFileCount?: number;
      error?: string;
    }>;
    importWorkspace: () => Promise<{
      ok: boolean;
      canceled?: boolean;
      workspaceId?: string;
      workspaceName?: string;
      fileCount?: number;
      error?: string;
    }>;
    /**
     * Returns workspaces whose canvas.json was clobbered by a v1-unaware
     * writer. Renderer surfaces sticky alerts for each; recovery is via
     * `canvas-cli restore`.
     */
    listPollutedWorkspaces: () => Promise<{
      ok: boolean;
      polluted?: Array<{ workspaceId: string; conflictingNodeIds: string[] }>;
      error?: string;
    }>;
    watchWorkspace: (workspaceId: string) => Promise<{ ok: boolean }>;
    onExternalUpdate: (
      callback: (event: {
        workspaceId: string;
        nodeIds: string[];
        kind?: 'create' | 'update' | 'delete';
        source: string;
      }) => void,
    ) => () => void;
    /**
     * Subscribe to canvas storage migration progress events.
     *
     * `errorKind` distinguishes a critical data-integrity event
     * (`'pollution'`) from a generic migration hiccup.
     */
    onMigrationProgress: (
      callback: (event: {
        workspaceId: string;
        phase:
          | 'starting'
          | 'backup'
          | 'split-nodes'
          | 'commit'
          | 'done'
          | 'error';
        current?: number;
        total?: number;
        message?: string;
        errorKind?: 'pollution' | 'other';
        conflictingNodeIds?: string[];
      }) => void,
    ) => () => void;
  };
  workspaceNodes: {
    list: (workspaceId: string) => Promise<{
      ok: boolean;
      nodes?: WorkspaceNodeListItem[];
      tags?: KnowledgeTagDefinition[];
      error?: string;
    }>;
    read: (workspaceId: string, nodeId: string) => Promise<{
      ok: boolean;
      node?: WorkspaceNodeRecord | null;
      error?: string;
    }>;
    tags: () => Promise<{
      ok: boolean;
      tags?: KnowledgeTagDefinition[];
      error?: string;
    }>;
    upsertTag: (tag: { id?: string; name: string; description?: string }) => Promise<{
      ok: boolean;
      tag?: KnowledgeTagDefinition;
      error?: string;
    }>;
    updateTags: (workspaceId: string, nodeId: string, tags: string[]) => Promise<{
      ok: boolean;
      node?: WorkspaceNodeRecord | null;
      error?: string;
    }>;
    update: (workspaceId: string, nodeId: string, patch: Partial<WorkspaceNodeRecord>) => Promise<{
      ok: boolean;
      node?: WorkspaceNodeRecord | null;
      error?: string;
    }>;
    /** Fires when workspace-node metadata changes in the main process. */
    onChange: (
      callback: (event: { workspaceIds: string[]; source: 'canvas-agent' | 'renderer' }) => void,
    ) => () => void;
  };
  file: FileApi;
  dialog: DialogApi;
  skills: SkillsApi;
  canvasSkills: CanvasSkillsApi;
  canvasMcp: CanvasMcpApi;
  canvasPlugins: CanvasPluginsApi;
  experimental: ExperimentalApi;
  channelConfig: ChannelConfigApi;
  builtInTools: BuiltInToolsConfigApi;
  model: CanvasModelApi;
  promptProfile: PromptProfileApi;
  agent: AgentApi;
  codexSessions: CodexSessionsApi;
  agentTeams: AgentTeamsApi;
  iframe: IframeApi;
  llm: LlmApi;
  artifacts: ArtifactsApi;
  shell: ShellApi;
  link: LinkApi;
  web: WebApi;
  plugin: PluginBridge;
}
