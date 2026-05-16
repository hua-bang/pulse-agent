import { contextBridge, ipcRenderer } from "electron";

const sendLog = (level: string, message: string, details?: string) => {
  ipcRenderer.send("app:log", { level, message, details });
};

window.addEventListener("error", (event) => {
  sendLog("renderer", "window error", String(event.error ?? event.message));
});

window.addEventListener("unhandledrejection", (event) => {
  sendLog("renderer", "unhandledrejection", String(event.reason));
});

contextBridge.exposeInMainWorld("canvasWorkspace", {
  version: "0.1.0",

  pty: {
    spawn: (id: string, cols?: number, rows?: number, cwd?: string, workspaceId?: string) =>
      ipcRenderer.invoke("pty:spawn", { id, cols, rows, cwd, workspaceId }),

    write: (id: string, data: string) =>
      ipcRenderer.send("pty:write", { id, data }),

    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.send("pty:resize", { id, cols, rows }),

    kill: (id: string) => ipcRenderer.send("pty:kill", { id }),

    getCwd: (id: string) => ipcRenderer.invoke("pty:getCwd", { id }),

    onData: (id: string, callback: (data: string) => void) => {
      const channel = `pty:data:${id}`;
      const handler = (_event: Electron.IpcRendererEvent, data: string) =>
        callback(data);
      ipcRenderer.on(channel, handler);
      return () => {
        ipcRenderer.removeListener(channel, handler);
      };
    },

    onExit: (id: string, callback: (exitCode: number) => void) => {
      const channel = `pty:exit:${id}`;
      const handler = (
        _event: Electron.IpcRendererEvent,
        exitCode: number
      ) => callback(exitCode);
      ipcRenderer.on(channel, handler);
      return () => {
        ipcRenderer.removeListener(channel, handler);
      };
    }
  },

  store: {
    save: (id: string, data: unknown) =>
      ipcRenderer.invoke("canvas:save", { id, data }),

    load: (id: string) =>
      ipcRenderer.invoke("canvas:load", { id }),

    list: () => ipcRenderer.invoke("canvas:list"),

    delete: (id: string) =>
      ipcRenderer.invoke("canvas:delete", { id }),

    getDir: (id: string) =>
      ipcRenderer.invoke("canvas:getDir", { id }),

    exportWorkspace: (id: string, name: string) =>
      ipcRenderer.invoke("canvas:exportWorkspace", { id, name }),

    importWorkspace: () =>
      ipcRenderer.invoke("canvas:importWorkspace"),

    watchWorkspace: (workspaceId: string) =>
      ipcRenderer.invoke("canvas:watchWorkspace", { workspaceId }),

    onExternalUpdate: (
      callback: (event: {
        workspaceId: string;
        nodeIds: string[];
        kind?: "create" | "update" | "delete";
        source: string;
      }) => void
    ) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: {
          workspaceId: string;
          nodeIds: string[];
          kind?: "create" | "update" | "delete";
          source: string;
        }
      ) => callback(payload);
      ipcRenderer.on("canvas:external-update", handler);
      return () => {
        ipcRenderer.removeListener("canvas:external-update", handler);
      };
    }
  },

  file: {
    createNote: (workspaceId?: string, name?: string) =>
      ipcRenderer.invoke("file:createNote", { workspaceId, name }),

    read: (filePath: string) =>
      ipcRenderer.invoke("file:read", { filePath }),

    write: (filePath: string, content: string) =>
      ipcRenderer.invoke("file:write", { filePath, content }),

    listDir: (dirPath: string, maxDepth?: number) =>
      ipcRenderer.invoke("file:listDir", { dirPath, maxDepth }),

    openDialog: () => ipcRenderer.invoke("file:openDialog"),

    saveAsDialog: (defaultName: string, content: string) =>
      ipcRenderer.invoke("file:saveAsDialog", { defaultName, content }),

    saveImage: (workspaceId: string | undefined, data: string, ext?: string) =>
      ipcRenderer.invoke("file:saveImage", { workspaceId, data, ext }),

    exportImage: (defaultName: string, data: string, ext?: string) =>
      ipcRenderer.invoke("file:exportImage", { defaultName, data, ext }),

    onChanged: (callback: (filePath: string, content: string) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: { filePath: string; content: string }
      ) => callback(payload.filePath, payload.content);
      ipcRenderer.on("canvas:file-changed", handler);
      return () => ipcRenderer.removeListener("canvas:file-changed", handler);
    }
  },

  dialog: {
    openFolder: () => ipcRenderer.invoke("dialog:openFolder")
  },

  skills: {
    install: () => ipcRenderer.invoke("skills:install")
  },

  iframe: {
    registerWebview: (workspaceId: string, nodeId: string, webContentsId: number) =>
      ipcRenderer.invoke("iframe:register-webview", { workspaceId, nodeId, webContentsId }),

    unregisterWebview: (workspaceId: string, nodeId: string) =>
      ipcRenderer.invoke("iframe:unregister-webview", { workspaceId, nodeId })
  },

  shell: {
    openExternal: (url: string) =>
      ipcRenderer.invoke("shell:openExternal", { url }) as Promise<{ ok: boolean; error?: string }>
  },

  llm: {
    generateHTML: (prompt: string) =>
      ipcRenderer.invoke("llm:generate-html", { prompt }) as Promise<{ ok: boolean; html?: string; error?: string }>,

    streamHTML: (prompt: string) =>
      ipcRenderer.invoke("llm:stream-html", { prompt }) as Promise<{ ok: boolean; requestId?: string; error?: string }>,

    onHTMLDelta: (requestId: string, callback: (delta: string) => void) => {
      const channel = `llm:html-delta:${requestId}`;
      const handler = (_event: Electron.IpcRendererEvent, delta: string) => callback(delta);
      ipcRenderer.on(channel, handler);
      return () => { ipcRenderer.removeListener(channel, handler); };
    },

    onHTMLComplete: (requestId: string, callback: (result: { ok: boolean; html?: string; error?: string }) => void) => {
      const channel = `llm:html-complete:${requestId}`;
      const handler = (_event: Electron.IpcRendererEvent, result: { ok: boolean; html?: string; error?: string }) => callback(result);
      ipcRenderer.on(channel, handler);
      return () => { ipcRenderer.removeListener(channel, handler); };
    },
  },


  promptProfile: {
    get: () => ipcRenderer.invoke("canvas-prompt-profile:get"),
    save: (profile: { preset?: string; customPrompt?: string }) =>
      ipcRenderer.invoke("canvas-prompt-profile:save", { profile }),
    reset: () => ipcRenderer.invoke("canvas-prompt-profile:reset"),
  },

  model: {
    status: () => ipcRenderer.invoke("canvas-model:status"),
    saveConfig: (config: unknown) => ipcRenderer.invoke("canvas-model:save-config", { config }),
    upsertProvider: (provider: unknown) => ipcRenderer.invoke("canvas-model:upsert-provider", { provider }),
    removeProvider: (providerId: string) => ipcRenderer.invoke("canvas-model:remove-provider", { providerId }),
    fetchModels: (providerId?: string, provider?: unknown) =>
      ipcRenderer.invoke("canvas-model:fetch-models", { providerId, provider }),
    upsertOption: (option: unknown, setCurrent?: boolean) =>
      ipcRenderer.invoke("canvas-model:upsert-option", { option, setCurrent }),
    setCurrent: (name?: string, providerId?: string) => ipcRenderer.invoke("canvas-model:set-current", { name, providerId }),
    removeOption: (name: string) => ipcRenderer.invoke("canvas-model:remove-option", { name }),
    reset: () => ipcRenderer.invoke("canvas-model:reset"),
  },

  agent: {
    chat: (
      workspaceId: string,
      message: string,
      mentionedWorkspaceIds?: string[],
      requestContext?: {
        executionMode?: 'auto' | 'ask';
        scope?: 'current_canvas' | 'selected_nodes';
        selectedNodes?: Array<{ id: string; title: string; type: string }>;
        quickAction?: string;
      },
      attachments?: Array<{ id: string; path: string; fileName?: string; mimeType?: string }>,
    ) =>
      ipcRenderer.invoke("canvas-agent:chat", { workspaceId, message, mentionedWorkspaceIds, requestContext, attachments }),

    onTextDelta: (sessionId: string, callback: (delta: string) => void) => {
      const channel = `canvas-agent:text-delta:${sessionId}`;
      const handler = (_event: Electron.IpcRendererEvent, delta: string) =>
        callback(delta);
      ipcRenderer.on(channel, handler);
      return () => {
        ipcRenderer.removeListener(channel, handler);
      };
    },

    onChatComplete: (
      sessionId: string,
      callback: (result: { ok: boolean; response?: string; debugTrace?: unknown; error?: string }) => void
    ) => {
      const channel = `canvas-agent:chat-complete:${sessionId}`;
      const handler = (
        _event: Electron.IpcRendererEvent,
        result: { ok: boolean; response?: string; debugTrace?: unknown; error?: string }
      ) => callback(result);
      ipcRenderer.on(channel, handler);
      return () => {
        ipcRenderer.removeListener(channel, handler);
      };
    },

    onToolCall: (
      sessionId: string,
      callback: (data: { name: string; args: any; toolCallId?: string }) => void,
    ) => {
      const channel = `canvas-agent:tool-call:${sessionId}`;
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { name: string; args: any; toolCallId?: string },
      ) => callback(data);
      ipcRenderer.on(channel, handler);
      return () => {
        ipcRenderer.removeListener(channel, handler);
      };
    },

    onToolResult: (
      sessionId: string,
      callback: (data: { name: string; result: string; toolCallId?: string }) => void,
    ) => {
      const channel = `canvas-agent:tool-result:${sessionId}`;
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { name: string; result: string; toolCallId?: string },
      ) => callback(data);
      ipcRenderer.on(channel, handler);
      return () => {
        ipcRenderer.removeListener(channel, handler);
      };
    },

    onToolInputStart: (sessionId: string, callback: (data: { id: string; toolName: string }) => void) => {
      const channel = `canvas-agent:tool-input-start:${sessionId}`;
      const handler = (_event: Electron.IpcRendererEvent, data: { id: string; toolName: string }) =>
        callback(data);
      ipcRenderer.on(channel, handler);
      return () => {
        ipcRenderer.removeListener(channel, handler);
      };
    },

    onToolInputDelta: (sessionId: string, callback: (data: { id: string; delta: string }) => void) => {
      const channel = `canvas-agent:tool-input-delta:${sessionId}`;
      const handler = (_event: Electron.IpcRendererEvent, data: { id: string; delta: string }) =>
        callback(data);
      ipcRenderer.on(channel, handler);
      return () => {
        ipcRenderer.removeListener(channel, handler);
      };
    },

    onToolInputEnd: (sessionId: string, callback: (data: { id: string }) => void) => {
      const channel = `canvas-agent:tool-input-end:${sessionId}`;
      const handler = (_event: Electron.IpcRendererEvent, data: { id: string }) =>
        callback(data);
      ipcRenderer.on(channel, handler);
      return () => {
        ipcRenderer.removeListener(channel, handler);
      };
    },

    onVisualStream: (
      callback: (data: {
        workspaceId: string;
        toolCallId: string;
        content: string;
        done?: boolean;
      }) => void,
    ) => {
      const channel = 'canvas-agent:visual-stream';
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { workspaceId: string; toolCallId: string; content: string; done?: boolean },
      ) => callback(data);
      ipcRenderer.on(channel, handler);
      return () => {
        ipcRenderer.removeListener(channel, handler);
      };
    },

    onClarifyRequest: (
      sessionId: string,
      callback: (data: { id: string; question: string; context?: string }) => void,
    ) => {
      const channel = `canvas-agent:clarify-request:${sessionId}`;
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { id: string; question: string; context?: string },
      ) => callback(data);
      ipcRenderer.on(channel, handler);
      return () => {
        ipcRenderer.removeListener(channel, handler);
      };
    },

    answerClarification: (sessionId: string, requestId: string, answer: string) =>
      ipcRenderer.invoke("canvas-agent:clarify-answer", { sessionId, requestId, answer }),

    abort: (sessionId: string) =>
      ipcRenderer.invoke("canvas-agent:abort", { sessionId }),

    getStatus: (workspaceId: string) =>
      ipcRenderer.invoke("canvas-agent:status", { workspaceId }),

    getHistory: (workspaceId: string) =>
      ipcRenderer.invoke("canvas-agent:history", { workspaceId }),

    listSessions: (workspaceId: string) =>
      ipcRenderer.invoke("canvas-agent:sessions", { workspaceId }),

    newSession: (workspaceId: string) =>
      ipcRenderer.invoke("canvas-agent:new-session", { workspaceId }),

    loadSession: (workspaceId: string, sessionId: string) =>
      ipcRenderer.invoke("canvas-agent:load-session", { workspaceId, sessionId }),

    listAllSessions: (workspaceNames: Record<string, string>) =>
      ipcRenderer.invoke("canvas-agent:all-sessions", { workspaceNames }),

    loadCrossWorkspaceSession: (targetWorkspaceId: string, sourceWorkspaceId: string, sessionId: string) =>
      ipcRenderer.invoke("canvas-agent:load-cross-workspace-session", { targetWorkspaceId, sourceWorkspaceId, sessionId }),

    listDebugRuns: () =>
      ipcRenderer.invoke("canvas-agent:debug-runs"),

    getDebugRun: (sessionId: string, runId: string) =>
      ipcRenderer.invoke("canvas-agent:debug-run", { sessionId, runId }),

    activate: (workspaceId: string) =>
      ipcRenderer.invoke("canvas-agent:activate", { workspaceId }),

    deactivate: (workspaceId: string) =>
      ipcRenderer.invoke("canvas-agent:deactivate", { workspaceId }),

    addImageToCanvas: (workspaceId: string, imagePath: string, title?: string) =>
      ipcRenderer.invoke("canvas-agent:add-image-to-canvas", { workspaceId, imagePath, title }),
  },

  artifacts: {
    list: (workspaceId: string) =>
      ipcRenderer.invoke("artifact:list", { workspaceId }),

    get: (workspaceId: string, artifactId: string) =>
      ipcRenderer.invoke("artifact:get", { workspaceId, artifactId }),

    create: (workspaceId: string, input: unknown) =>
      ipcRenderer.invoke("artifact:create", { workspaceId, input }),

    addVersion: (workspaceId: string, artifactId: string, input: unknown) =>
      ipcRenderer.invoke("artifact:add-version", { workspaceId, artifactId, input }),

    update: (workspaceId: string, artifactId: string, patch: unknown) =>
      ipcRenderer.invoke("artifact:update", { workspaceId, artifactId, patch }),

    delete: (workspaceId: string, artifactId: string) =>
      ipcRenderer.invoke("artifact:delete", { workspaceId, artifactId }),

    pinToCanvas: (workspaceId: string, artifactId: string, placement?: unknown) =>
      ipcRenderer.invoke("artifact:pin-to-canvas", { workspaceId, artifactId, placement }),

    onChange: (
      callback: (event: { workspaceId: string; artifactId: string; kind: "create" | "update" | "delete" }) => void,
    ) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: { workspaceId: string; artifactId: string; kind: "create" | "update" | "delete" },
      ) => callback(payload);
      ipcRenderer.on("artifact:change", handler);
      return () => {
        ipcRenderer.removeListener("artifact:change", handler);
      };
    },
  },

  // Generic bridge for Canvas plugins. Backs RendererCtx.invoke so any
  // built-in plugin can reach its main half through a single channel
  // namespace (`plugin:<id>:<channel>`).
  plugin: {
    invoke: (pluginId: string, channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`plugin:${pluginId}:${channel}`, ...args),
  },

  web: {
    /**
     * Read a webpage that is already open in a canvas iframe node.
     * The webview must be registered (i.e. the iframe node is mounted and loaded).
     *
     * strategy: 'auto' (default) — dom → a11y → screenshot
     * strategy: 'dom'            — innerText extraction (safe, always works)
     * strategy: 'a11y'           — CDP accessibility tree (semantic roles/names)
     * strategy: 'screenshot'     — capturePage() PNG as data URL (for vision)
     */
    read: (payload: {
      workspaceId: string;
      nodeId: string;
      strategy?: 'auto' | 'dom' | 'a11y' | 'screenshot';
      maxChars?: number;
      sparseThreshold?: number;
    }) => ipcRenderer.invoke("web:read", payload),
  },
});
