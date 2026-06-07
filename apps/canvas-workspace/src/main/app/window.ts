import { BrowserWindow, shell } from "electron";
import { APP_NAME } from "./identity";
import { isSafeExternalUrl } from "./shell-ipc";
import type { WriteLog } from "./logging";

export interface CreateWindowOptions {
  preloadPath: string;
  rendererIndexPath: string;
  iconPath?: string;
  writeLog: WriteLog;
}

export function createWindow({
  preloadPath,
  rendererIndexPath,
  iconPath,
  writeLog,
}: CreateWindowOptions): BrowserWindow {
  void writeLog("main", "preload", preloadPath);
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: APP_NAME,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#f6f6f4",
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      // Enable <webview> so iframe/link canvas nodes can host a real
      // webContents. Main-process code reaches into each webview via its
      // webContents ID to pull rendered DOM text for the Canvas Agent.
      webviewTag: true
    }
  });

  // The main renderer should never navigate away from the app shell. If a
  // sandboxed iframe somehow tries to top-navigate, push the URL to the OS
  // browser and cancel the load. Popups from this webContents are handled
  // by the app-level web-contents-created listener.
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
    void writeLog("main", "loadFile", rendererIndexPath);
    win.loadFile(rendererIndexPath);
  }

  return win;
}
