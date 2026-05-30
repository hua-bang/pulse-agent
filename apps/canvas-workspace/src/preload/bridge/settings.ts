import type { IpcRenderer } from "electron";
import type {
  CanvasMcpApi,
  CanvasModelApi,
  CanvasSkillsApi,
  DialogApi,
  ExperimentalApi,
  PromptProfileApi,
  SkillsApi
} from "../../renderer/src/types";

export const createDialogApi = (ipcRenderer: IpcRenderer): DialogApi => ({
  openFolder: () => ipcRenderer.invoke("dialog:openFolder")
});

export const createSkillsApi = (ipcRenderer: IpcRenderer): SkillsApi => ({
  install: () => ipcRenderer.invoke("skills:install"),
  status: () => ipcRenderer.invoke("skills:status"),
  cleanupLegacy: () => ipcRenderer.invoke("skills:cleanup-legacy")
});

export const createCanvasSkillsApi = (ipcRenderer: IpcRenderer): CanvasSkillsApi => ({
  list: (scope) => ipcRenderer.invoke("canvas-skills:list", { scope }),

  upsert: (scope, skill) =>
    ipcRenderer.invoke("canvas-skills:upsert", { scope, skill }),

  remove: (scope, name) =>
    ipcRenderer.invoke("canvas-skills:remove", { scope, name }),

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

  importJson: (scope, json) =>
    ipcRenderer.invoke("canvas-mcp:import-json", { scope, json })
});

export const createExperimentalApi = (ipcRenderer: IpcRenderer): ExperimentalApi => ({
  list: () => ipcRenderer.invoke("experimental:list"),

  set: (id, enabled) =>
    ipcRenderer.invoke("experimental:set", { id, enabled }),

  reset: () => ipcRenderer.invoke("experimental:reset"),

  reloadWindow: () => ipcRenderer.invoke("experimental:reload-window")
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
