import { app, BrowserWindow, ipcMain, net, protocol, shell } from "electron";
import { existsSync, promises as fs } from "fs";
import { dirname, join, normalize, isAbsolute } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { setupPtyIpc, killAllPty } from "./pty-manager";
import { setupCanvasStoreIpc, teardownCanvasWatchers } from "./canvas-store";
import { setupFileManagerIpc } from "./file-manager";
// MCP server disabled — canvas-cli is the preferred agent interface now.
// import { startMCPServer } from "./mcp-server";
// import { ensureMCPRegistered } from "./mcp-registration";
import { setupFileWatcherIpc, teardownFileWatcher } from "./file-watcher";
import { setupSkillInstallerIpc } from "./skill-installer";
import { setupCanvasAgentIpc, teardownCanvasAgent } from "./canvas-agent-ipc";
import { setupCanvasModelIpc } from "./canvas-model-ipc";
import { setupCanvasPromptIpc } from "./canvas-prompt-ipc";
import { setupWebviewRegistryIpc } from "./webview-registry";
import { setupHtmlGeneratorIpc } from "./html-generator-ipc";
import { setupArtifactIpc } from "./artifact-ipc";
import { setupShellIpc, isSafeExternalUrl } from "./shell-ipc";
import { setupWebpageReaderIpc } from "./webpage-reader-ipc";
import { BUILT_IN_MAIN_PLUGINS, setupCanvasPlugins } from "../plugins/main";

const currentDir = dirname(fileURLToPath(import.meta.url));
const preloadPath = join(currentDir, "../preload/index.mjs");
const preloadFallbackPath = join(currentDir, "../preload/index.js");
const resolvedPreloadPath = existsSync(preloadPath)
  ? preloadPath
  : preloadFallbackPath;

// Resolve the app icon for window/taskbar display. Works in dev, preview,
// and packaged builds (resources/ is shipped via electron-builder files).
const iconCandidates = [
  join(currentDir, "../../resources/icon.png"),
  join(currentDir, "../../build/icon.png"),
  join(process.resourcesPath ?? "", "resources/icon.png")
];
const resolvedIconPath = iconCandidates.find((p) => p && existsSync(p));
const logDir = join(app.getPath("userData"), "logs");
const logFile = join(logDir, "app.log");

// Custom scheme for serving local image/file assets to the renderer.
// Chromium blocks `file://` URLs in renderer-loaded pages for security
// reasons, so any <img src="file://…"> from disk fails to load. We expose
// the same bytes under `pulse-canvas://local/<absolute-path>` so the
// renderer can reference local files without disabling webSecurity.
//
// This MUST run before `app.whenReady()` — privileged scheme registration
// is only effective during app startup.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "pulse-canvas",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

const writeLog = async (level: string, message: string, details?: string) => {
  const timestamp = new Date().toISOString();
  const line = details
    ? `[${timestamp}] [${level}] ${message}\n${details}\n`
    : `[${timestamp}] [${level}] ${message}\n`;

  try {
    await fs.mkdir(logDir, { recursive: true });
    await fs.appendFile(logFile, line);
  } catch (error) {
    console.error("Failed to write log", error);
  }
};

const registerPulseCanvasProtocol = () => {
  protocol.handle("pulse-canvas", async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== "local") {
        return new Response("Unsupported host", { status: 400 });
      }
      // pathname is like "/Users/foo/.pulse-coder/canvas/ws-x/images/img.png"
      // — percent-decode each segment, then join with the platform separator.
      const segments = url.pathname.split("/").map((s) => {
        try {
          return decodeURIComponent(s);
        } catch {
          return s;
        }
      });
      const joined = segments.join("/");
      const normalized = normalize(joined);
      if (!isAbsolute(normalized)) {
        return new Response("Path must be absolute", { status: 400 });
      }
      // Reject path traversal attempts after normalization.
      if (normalized.includes("..")) {
        return new Response("Forbidden", { status: 403 });
      }
      // Defer existence checks to fetch — it returns the right status code.
      return net.fetch(pathToFileURL(normalized).toString());
    } catch (error) {
      void writeLog("protocol", "pulse-canvas handler failed", String(error));
      return new Response("Internal error", { status: 500 });
    }
  });
};

const createWindow = () => {
  void writeLog("main", "preload", resolvedPreloadPath);
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#f6f6f4",
    ...(resolvedIconPath ? { icon: resolvedIconPath } : {}),
    webPreferences: {
      preload: resolvedPreloadPath,
      contextIsolation: true,
      // Enable <webview> so iframe/link canvas nodes can host a real
      // webContents. Main-process code reaches into each webview via its
      // webContents ID to pull rendered DOM text for the Canvas Agent.
      webviewTag: true
    }
  });

  // Sandboxed iframe canvas nodes (HTML / AI / artifact previews) get
  // `allow-popups` so their `<a target="_blank">` and `window.open()` reach
  // the parent window. Without a handler here those popups would either
  // open a useless blank Electron window or be denied outright — route
  // every popup through the OS browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Same idea for in-place navigations: the main renderer should never
  // navigate away from the app shell. If a sandboxed iframe somehow tries
  // to top-navigate, push the URL to the OS browser and cancel the load.
  win.webContents.on("will-navigate", (event, url) => {
    if (url === win.webContents.getURL()) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
  });

  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    console.error("Renderer failed to load", errorCode, errorDescription);
    void writeLog(
      "renderer",
      `failed to load (${errorCode}) ${errorDescription}`
    );
  });

  win.webContents.on("render-process-gone", (_event, details) => {
    console.error("Renderer process crashed", details.reason);
    void writeLog("renderer", `process gone: ${details.reason}`);
  });

  win.webContents.on(
    "console-message",
    (_event, level, message, line, sourceId) => {
      const details = `${sourceId}:${line}`;
      void writeLog("console", `L${level} ${message}`, details);
    }
  );

  if (process.env.ELECTRON_RENDERER_URL) {
    void writeLog("main", "loadURL", process.env.ELECTRON_RENDERER_URL);
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    const filePath = join(currentDir, "../renderer/index.html");
    void writeLog("main", "loadFile", filePath);
    win.loadFile(filePath);
  }
};

app.whenReady().then(() => {
  registerPulseCanvasProtocol();

  // Set the macOS dock icon in dev/preview (packaged builds use the .icns
  // from electron-builder, so this is a no-op there).
  if (process.platform === "darwin" && resolvedIconPath && app.dock) {
    try {
      app.dock.setIcon(resolvedIconPath);
    } catch (error) {
      void writeLog("main", "dock.setIcon failed", String(error));
    }
  }

  // About panel: shown by the native menu (macOS: Pulse Canvas > About;
  // Linux: Help > About). iconPath is honored on Linux/Windows; macOS
  // reads the icon from the app bundle.
  app.setAboutPanelOptions({
    applicationName: "Pulse Canvas",
    applicationVersion: app.getVersion(),
    copyright: "Copyright © 2025",
    ...(resolvedIconPath ? { iconPath: resolvedIconPath } : {})
  });

  ipcMain.on("app:log", (_event, payload) => {
    const level = payload?.level ?? "renderer";
    const message = payload?.message ?? "log";
    const details = payload?.details;
    void writeLog(level, message, details);
  });

  process.on("uncaughtException", (error) => {
    console.error("Main uncaughtException", error);
    void writeLog("main", "uncaughtException", String(error?.stack ?? error));
  });

  process.on("unhandledRejection", (reason) => {
    console.error("Main unhandledRejection", reason);
    void writeLog("main", "unhandledRejection", String(reason));
  });

  setupPtyIpc();
  setupCanvasStoreIpc();
  setupFileManagerIpc();
  setupFileWatcherIpc();
  setupSkillInstallerIpc();
  setupCanvasAgentIpc();
  setupCanvasModelIpc();
  setupCanvasPromptIpc();
  setupWebviewRegistryIpc();
  setupHtmlGeneratorIpc();
  setupArtifactIpc();
  setupShellIpc();
  setupWebpageReaderIpc();
  void setupCanvasPlugins(BUILT_IN_MAIN_PLUGINS);
  // MCP server disabled — canvas-cli is the preferred agent interface now.
  // startMCPServer();
  // void ensureMCPRegistered();

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  killAllPty();
  teardownFileWatcher();
  teardownCanvasWatchers();
  teardownCanvasAgent();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
