import { contextBridge, ipcRenderer } from "electron";
import type { CanvasWorkspaceApi } from "../renderer/src/types";
import { createAgentApi } from "./bridge/agent";
import { createAgentTeamsApi } from "./bridge/agent-teams";
import { createAppInfoApi } from "./bridge/app-info";
import { createArtifactsApi } from "./bridge/artifacts";
import { createCodexSessionsApi } from "./bridge/codex-sessions";
import { createDefaultBrowserApi } from "./bridge/default-browser";
import { createMemoryReportApi } from "./bridge/memory-report";
import { createArtifactCapabilitiesApi } from "./bridge/artifact-capabilities";
import { createDockApi } from "./bridge/dock";
import { createFileApi } from "./bridge/file";
import { readPluginFlags } from "./bridge/flags";
import { createHistoryApi } from "./bridge/history";
import { createLogSender, installRendererErrorLogging } from "./bridge/logging";
import { createPluginBridge } from "./bridge/plugin";
import { createPtyApi } from "./bridge/pty";
import {
  createCanvasMcpApi,
  createCanvasPluginsApi,
  createCanvasSkillsApi,
  createBuiltInToolsConfigApi,
  createChannelConfigApi,
  createDialogApi,
  createExperimentalApi,
  createModelApi,
  createPromptProfileApi,
  createSkillsApi
} from "./bridge/settings";
import { createStoreApi } from "./bridge/store";
import {
  createIframeApi,
  createLinkApi,
  createLlmApi,
  createShellApi,
  createWebApi
} from "./bridge/webview";
import { createWorkspaceNodesApi } from "./bridge/workspace-nodes";

declare const __APP_VERSION__: string;

const configuredWebviewConcurrency = Number.parseInt(
  process.env.PULSE_CANVAS_WEBVIEW_CONCURRENCY ?? '',
  10,
);

const sendLog = createLogSender(ipcRenderer);
installRendererErrorLogging(sendLog);

const canvasWorkspace: CanvasWorkspaceApi = {
  version: __APP_VERSION__,
  runtimeConfig: {
    perfMode: process.env.PULSE_CANVAS_PERF === '1',
    webviewInitialLoadConcurrency:
      process.env.PULSE_CANVAS_PERF === '1'
      && Number.isFinite(configuredWebviewConcurrency)
      && configuredWebviewConcurrency >= 0
        ? configuredWebviewConcurrency
        : 2,
  },
  appInfo: createAppInfoApi(ipcRenderer),
  pluginFlags: readPluginFlags(ipcRenderer, sendLog),
  pty: createPtyApi(ipcRenderer),
  store: createStoreApi(ipcRenderer),
  workspaceNodes: createWorkspaceNodesApi(ipcRenderer),
  file: createFileApi(ipcRenderer),
  dialog: createDialogApi(ipcRenderer),
  skills: createSkillsApi(ipcRenderer),
  canvasSkills: createCanvasSkillsApi(ipcRenderer),
  canvasMcp: createCanvasMcpApi(ipcRenderer),
  canvasPlugins: createCanvasPluginsApi(ipcRenderer),
  experimental: createExperimentalApi(ipcRenderer),
  channelConfig: createChannelConfigApi(ipcRenderer),
  builtInTools: createBuiltInToolsConfigApi(ipcRenderer),
  iframe: createIframeApi(ipcRenderer),
  shell: createShellApi(ipcRenderer),
  link: createLinkApi(ipcRenderer),
  defaultBrowser: createDefaultBrowserApi(ipcRenderer),
  llm: createLlmApi(ipcRenderer),
  promptProfile: createPromptProfileApi(ipcRenderer),
  model: createModelApi(ipcRenderer),
  memoryReport: createMemoryReportApi(ipcRenderer),
  artifactCapabilities: createArtifactCapabilitiesApi(ipcRenderer),
  agent: createAgentApi(ipcRenderer),
  codexSessions: createCodexSessionsApi(ipcRenderer),
  agentTeams: createAgentTeamsApi(ipcRenderer),
  artifacts: createArtifactsApi(ipcRenderer),
  plugin: createPluginBridge(ipcRenderer),
  dock: createDockApi(ipcRenderer),
  history: createHistoryApi(ipcRenderer),
  web: createWebApi(ipcRenderer)
};

contextBridge.exposeInMainWorld("canvasWorkspace", canvasWorkspace);
