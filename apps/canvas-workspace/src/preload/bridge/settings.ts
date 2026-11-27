import type { IpcRenderer, IpcRendererEvent } from "electron";
import type {
  CanvasMcpApi,
  BuiltInToolsConfigApi,
  CanvasPluginsApi,
  CanvasSkillsApi,
  PluginNotificationEvent,
  SkillsApi
} from "../../shared/api/settings-config";
import type { CanvasModelApi, PromptProfileApi } from "../../shared/api/models";
import type { ChannelConfigApi } from "../../shared/api/channel-config";
import type { DialogApi } from "../../shared/api/files";
import type { ExperimentalApi } from "../../shared/api/experimental";
import type { TelemetryApi } from "../../shared/api/telemetry";
import type { RemoteVpsApi } from "../../shared/api/remote-vps";
import type { ToolingInstallStatus } from "../../shared/experimental-features";

export const createDialogApi = (ipcRenderer: IpcRenderer): DialogApi => ({
  openFolder: () => ipcRenderer.invoke("dialog:openFolder")
});

export const createSkillsApi = (ipcRenderer: IpcRenderer): SkillsApi => ({
  install: () => ipcRenderer.invoke("skills:install"),
  update: () => ipcRenderer.invoke("skills:update"),
  status: () => ipcRenderer.invoke("skills:status"),
  setUpdatePolicy: (policy) => ipcRenderer.invoke("skills:set-update-policy", { policy }),
  configurePath: () => ipcRenderer.invoke("skills:configure-path"),
  cleanupLegacy: () => ipcRenderer.invoke("skills:cleanup-legacy")
});

export const createCanvasSkillsApi = (ipcRenderer: IpcRenderer): CanvasSkillsApi => ({
  list: (scope) => ipcRenderer.invoke("canvas-skills:list", { scope }),

  upsert: (scope, skill) =>
    ipcRenderer.invoke("canvas-skills:upsert", { scope, skill }),

  remove: (scope, name) =>
    ipcRenderer.invoke("canvas-skills:remove", { scope, name }),

  promote: (workspaceId, name) =>
    ipcRenderer.invoke("canvas-skills:promote", { workspaceId, name }),

  importZip: (scope, bytes) =>
    ipcRenderer.invoke("canvas-skills:import-zip", { scope, bytes }),

  importMd: (scope, text) =>
    ipcRenderer.invoke("canvas-skills:import-md", { scope, text }),

  importUrl: (scope, url) =>
    ipcRenderer.invoke("canvas-skills:import-url", { scope, url })
});

export const createCanvasMcpApi = (ipcRenderer: IpcRenderer): CanvasMcpApi => ({
  list: (scope) => ipcRenderer.invoke("canvas-mcp:list", { scope }),

  upsert: (scope, server, originalName) =>
    ipcRenderer.invoke("canvas-mcp:upsert", { scope, server, originalName }),

  remove: (scope, name) =>
    ipcRenderer.invoke("canvas-mcp:remove", { scope, name }),

  reload: (scope) => ipcRenderer.invoke("canvas-mcp:reload", { scope }),

  importJson: (scope, json) =>
    ipcRenderer.invoke("canvas-mcp:import-json", { scope, json }),

  setToolEnabled: (scope, name, tool, enabled) =>
    ipcRenderer.invoke("canvas-mcp:set-tool-enabled", { scope, name, tool, enabled }),

  oauthConnect: (scope, name) =>
    ipcRenderer.invoke("canvas-mcp:oauth-connect", { scope, name }),

  oauthDisconnect: (scope, name) =>
    ipcRenderer.invoke("canvas-mcp:oauth-disconnect", { scope, name })
});

export const createCanvasPluginsApi = (ipcRenderer: IpcRenderer): CanvasPluginsApi => ({
  list: () => ipcRenderer.invoke("canvas-plugins:list"),

  addDirectory: (dir) =>
    ipcRenderer.invoke("canvas-plugins:add-directory", { dir }),

  chooseDirectory: () =>
    ipcRenderer.invoke("canvas-plugins:choose-directory"),

  removeDirectory: (dir) =>
    ipcRenderer.invoke("canvas-plugins:remove-directory", { dir }),

  importJson: (json) =>
    ipcRenderer.invoke("canvas-plugins:import-json", { json }),

  setConfig: (pluginId, key, value) =>
    ipcRenderer.invoke("canvas-plugins:set-config", { pluginId, key, value }),

  onChanged: (cb: () => void) => {
    const channel = "canvas-plugins:changed";
    const listener = () => cb();
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },

  takePendingOpen: () => ipcRenderer.invoke("canvas-plugins:take-pending-open"),

  onNotification: (cb) => {
    const channel = "canvas-plugins:notification";
    const listener = (_event: IpcRendererEvent, payload: PluginNotificationEvent) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  }
});

export const createExperimentalApi = (ipcRenderer: IpcRenderer): ExperimentalApi => ({
  list: () => ipcRenderer.invoke("experimental:list"),

  set: (id, enabled) =>
    ipcRenderer.invoke("experimental:set", { id, enabled }),

  reset: () => ipcRenderer.invoke("experimental:reset"),

  reloadWindow: () => ipcRenderer.invoke("experimental:reload-window"),

  onToolingStatus: (cb: (status: ToolingInstallStatus) => void) => {
    const channel = "experimental:tooling-status";
    const listener = (_event: IpcRendererEvent, status: ToolingInstallStatus) => cb(status);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  }
});

export const createChannelConfigApi = (ipcRenderer: IpcRenderer): ChannelConfigApi => ({
  status: () => ipcRenderer.invoke("channel-config:status"),

  setFeishu: (input) => ipcRenderer.invoke("channel-config:set-feishu", input),

  clearFeishu: () => ipcRenderer.invoke("channel-config:clear-feishu"),

  relaunch: () => ipcRenderer.invoke("channel-config:relaunch")
});

export const createBuiltInToolsConfigApi = (ipcRenderer: IpcRenderer): BuiltInToolsConfigApi => ({
  status: () => ipcRenderer.invoke("built-in-tools:status"),

  setCredential: (id, input) =>
    ipcRenderer.invoke("built-in-tools:set-credential", { id, ...input }),

  clearCredential: (id) =>
    ipcRenderer.invoke("built-in-tools:clear-credential", { id })
});

export const createPromptProfileApi = (ipcRenderer: IpcRenderer): PromptProfileApi => ({
  get: () => ipcRenderer.invoke("canvas-prompt-profile:get"),

  save: (profile) =>
    ipcRenderer.invoke("canvas-prompt-profile:save", { profile }),

  reset: () => ipcRenderer.invoke("canvas-prompt-profile:reset")
});

export const createModelApi = (ipcRenderer: IpcRenderer): CanvasModelApi => ({
  status: () => ipcRenderer.invoke("canvas-model:status"),

  saveConfig: (config) =>
    ipcRenderer.invoke("canvas-model:save-config", { config }),

  upsertProvider: (provider) =>
    ipcRenderer.invoke("canvas-model:upsert-provider", { provider }),

  removeProvider: (providerId) =>
    ipcRenderer.invoke("canvas-model:remove-provider", { providerId }),

  fetchModels: (providerId, provider) =>
    ipcRenderer.invoke("canvas-model:fetch-models", { providerId, provider }),

  upsertOption: (option, setCurrent) =>
    ipcRenderer.invoke("canvas-model:upsert-option", { option, setCurrent }),

  setCurrent: (name, providerId) =>
    ipcRenderer.invoke("canvas-model:set-current", { name, providerId }),

  removeOption: (name) =>
    ipcRenderer.invoke("canvas-model:remove-option", { name }),

  reset: () => ipcRenderer.invoke("canvas-model:reset")
});

export const createTelemetryApi = (ipcRenderer: IpcRenderer): TelemetryApi => ({
  track: (event, props) => ipcRenderer.invoke("telemetry:track", { event, props }),
  status: () => ipcRenderer.invoke("telemetry:status"),
  setEnabled: (enabled) => ipcRenderer.invoke("telemetry:set-enabled", { enabled })
});

export const createRemoteVpsApi = (ipcRenderer: IpcRenderer): RemoteVpsApi => ({
  listSshHosts: () => ipcRenderer.invoke("remote-vps:listSshHosts"),
  getConfig: (workspaceId) => ipcRenderer.invoke("remote-vps:getConfig", { workspaceId }),
  getStatus: (workspaceId) => ipcRenderer.invoke("remote-vps:getStatus", { workspaceId }),
  saveConfig: (workspaceId, config) =>
    ipcRenderer.invoke("remote-vps:saveConfig", { workspaceId, config }),
  removeConfig: (workspaceId) =>
    ipcRenderer.invoke("remote-vps:removeConfig", { workspaceId }),
  testAndBootstrap: (workspaceId, config) =>
    ipcRenderer.invoke("remote-vps:testAndBootstrap", { workspaceId, config }),
  migrateLocal: (workspaceId, config, options) =>
    ipcRenderer.invoke("remote-vps:migrateLocal", {
      workspaceId,
      config,
      onlyIfRemoteEmpty: options?.onlyIfRemoteEmpty,
    }),
  readWorkspaceDoc: (workspaceId, cwd) =>
    ipcRenderer.invoke("remote-vps:readWorkspaceDoc", { workspaceId, cwd }),
  writeWorkspaceDoc: (workspaceId, content, cwd) =>
    ipcRenderer.invoke("remote-vps:writeWorkspaceDoc", { workspaceId, content, cwd }),
  listDirs: (workspaceId, dirPath, options) =>
    ipcRenderer.invoke("remote-vps:listDirs", {
      workspaceId,
      dirPath,
      showHidden: options?.showHidden,
      config: options?.config,
    }),
  listShares: (workspaceId) =>
    ipcRenderer.invoke("remote-vps:listShares", { workspaceId }),
  createShare: (workspaceId, options) =>
    ipcRenderer.invoke("remote-vps:createShare", { workspaceId, ...options }),
  revokeShare: (workspaceId, shareId) =>
    ipcRenderer.invoke("remote-vps:revokeShare", { workspaceId, shareId }),
  joinShare: (workspaceId, inviteCode) =>
    ipcRenderer.invoke("remote-vps:joinShare", { workspaceId, inviteCode }),
  getPresence: (workspaceId) =>
    ipcRenderer.invoke("remote-vps:getPresence", { workspaceId }),
  updatePresence: (workspaceId, state) =>
    ipcRenderer.invoke("remote-vps:updatePresence", { workspaceId, ...state }),
  leavePresence: (workspaceId) =>
    ipcRenderer.invoke("remote-vps:leavePresence", { workspaceId }),
  onJoinDeepLink: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { inviteCode?: string }) => {
      if (payload?.inviteCode) callback(payload.inviteCode);
    };
    ipcRenderer.on("remote-vps:join-link", listener);
    return () => ipcRenderer.removeListener("remote-vps:join-link", listener);
  },
  consumePendingJoinLinks: () =>
    ipcRenderer.invoke("remote-vps:consumePendingJoinLinks"),
  getChatRoomState: (workspaceId, conversationId) =>
    ipcRenderer.invoke("remote-vps:chatRoomState", { workspaceId, conversationId }),
  enqueueChatRoom: (workspaceId, conversationId, message) =>
    ipcRenderer.invoke("remote-vps:chatRoomEnqueue", { workspaceId, conversationId, message }),
  claimChatRoom: (workspaceId, conversationId, options) =>
    ipcRenderer.invoke("remote-vps:chatRoomClaim", { workspaceId, conversationId, ...options }),
  streamChatRoom: (workspaceId, conversationId, text, toolName) =>
    ipcRenderer.invoke("remote-vps:chatRoomStream", { workspaceId, conversationId, text, toolName }),
  releaseChatRoom: (workspaceId, conversationId) =>
    ipcRenderer.invoke("remote-vps:chatRoomRelease", { workspaceId, conversationId }),
  cancelChatRoomQueued: (workspaceId, conversationId, itemId) =>
    ipcRenderer.invoke("remote-vps:chatRoomCancel", { workspaceId, conversationId, itemId }),
  setChatRoomTyping: (workspaceId, conversationId, active) =>
    ipcRenderer.invoke("remote-vps:chatRoomTyping", { workspaceId, conversationId, active }),
  sendChatRoomNote: (workspaceId, conversationId, message) =>
    ipcRenderer.invoke("remote-vps:chatRoomNote", { workspaceId, conversationId, message }),
  subscribeChatRoom: (workspaceId) =>
    ipcRenderer.invoke("remote-vps:chatRoomSubscribe", { workspaceId }),
  unsubscribeChatRoom: (workspaceId) =>
    ipcRenderer.invoke("remote-vps:chatRoomUnsubscribe", { workspaceId }),
  onChatRoomEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: any) => {
      if (payload?.workspaceId && payload?.conversationId) callback(payload);
    };
    ipcRenderer.on("remote-vps:chat-room-event", listener);
    return () => ipcRenderer.removeListener("remote-vps:chat-room-event", listener);
  },
});
