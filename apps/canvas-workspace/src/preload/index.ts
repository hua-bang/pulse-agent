import { contextBridge, ipcRenderer } from "electron";
import type { CanvasWorkspaceApi } from "../renderer/src/types";
import { createAgentApi } from "./bridge/agent";
import { createArtifactsApi } from "./bridge/artifacts";
import { createFileApi } from "./bridge/file";
import { readPluginFlags } from "./bridge/flags";
import { createLogSender, installRendererErrorLogging } from "./bridge/logging";
import { createPluginBridge } from "./bridge/plugin";
import { createPtyApi } from "./bridge/pty";
import {
  createCanvasMcpApi,
  createCanvasSkillsApi,
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

const sendLog = createLogSender(ipcRenderer);
installRendererErrorLogging(sendLog);

const canvasWorkspace: CanvasWorkspaceApi = {
  version: "0.1.0",
  pluginFlags: readPluginFlags(ipcRenderer, sendLog),
  pty: createPtyApi(ipcRenderer),
  store: createStoreApi(ipcRenderer),
  workspaceNodes: createWorkspaceNodesApi(ipcRenderer),
  file: createFileApi(ipcRenderer),
  dialog: createDialogApi(ipcRenderer),
  skills: createSkillsApi(ipcRenderer),
  canvasSkills: createCanvasSkillsApi(ipcRenderer),
  canvasMcp: createCanvasMcpApi(ipcRenderer),
  experimental: createExperimentalApi(ipcRenderer),
  iframe: createIframeApi(ipcRenderer),
  shell: createShellApi(ipcRenderer),
  link: createLinkApi(ipcRenderer),
  llm: createLlmApi(ipcRenderer),
  promptProfile: createPromptProfileApi(ipcRenderer),
  model: createModelApi(ipcRenderer),
  agent: createAgentApi(ipcRenderer),
  artifacts: createArtifactsApi(ipcRenderer),
  plugin: createPluginBridge(ipcRenderer),
  web: createWebApi(ipcRenderer)
};

contextBridge.exposeInMainWorld("canvasWorkspace", canvasWorkspace);
