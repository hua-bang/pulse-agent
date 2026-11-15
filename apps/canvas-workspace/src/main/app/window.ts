import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, nativeTheme, screen, shell, type Rectangle } from "electron";
import { APP_NAME } from "./identity";
import { isSafeExternalUrl } from "./shell-ipc";
import type { WriteLog } from "./logging";

export interface CreateWindowOptions {
  preloadPath: string;
  webviewFindPreloadPath: string;
  rendererIndexPath: string;
  iconPath?: string;
  writeLog: WriteLog;
}

const DEFAULT_SIZE = { width: 1200, height: 800 };
const MIN_SIZE = { width: 900, height: 600 };
/** Part of the saved frame that must lie on a display to reuse its position. */
const MIN_VISIBLE_PX = { width: 120, height: 40 };
const WINDOW_STATE_FILE = "window-state.json";

export interface WindowPlacement {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

const isFiniteNumber = (value: unknown): value is number => (
  typeof value === "number" && Number.isFinite(value)
);

const overlap = (a: Rectangle, b: Rectangle): { width: number; height: number } => ({
  width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
});

/**
 * Turn a saved window state into safe bounds. The size is kept between the
 * minimum and the largest display. The position is kept only when enough of
 * the frame lies on a current display; otherwise the window is centred.
 * Anything unreadable falls back to the 1200×800 default.
 */
export function resolveWindowPlacement(saved: unknown, workAreas: Rectangle[]): WindowPlacement {
  const state = (saved && typeof saved === "object" ? saved : {}) as Record<string, unknown>;
  const maxWidth = Math.max(MIN_SIZE.width, ...workAreas.map((area) => area.width));
  const maxHeight = Math.max(MIN_SIZE.height, ...workAreas.map((area) => area.height));
  const width = isFiniteNumber(state.width)
    ? Math.round(Math.min(maxWidth, Math.max(MIN_SIZE.width, state.width)))
    : DEFAULT_SIZE.width;
  const height = isFiniteNumber(state.height)
    ? Math.round(Math.min(maxHeight, Math.max(MIN_SIZE.height, state.height)))
    : DEFAULT_SIZE.height;
  const maximized = state.maximized === true;
  if (!isFiniteNumber(state.x) || !isFiniteNumber(state.y)) return { width, height, maximized };

  const frame = { x: Math.round(state.x), y: Math.round(state.y), width, height };
  const visible = workAreas.some((area) => {
    const shared = overlap(frame, area);
    return shared.width >= MIN_VISIBLE_PX.width && shared.height >= MIN_VISIBLE_PX.height;
  });
  return visible ? { ...frame, maximized } : { width, height, maximized };
}

const windowStatePath = () => join(app.getPath("userData"), WINDOW_STATE_FILE);

const readWindowPlacement = (): WindowPlacement => {
  let saved: unknown = null;
  try {
    saved = JSON.parse(readFileSync(windowStatePath(), "utf8"));
  } catch {
    // First launch or an unreadable file: use the default size.
  }
  return resolveWindowPlacement(saved, screen.getAllDisplays().map((display) => display.workArea));
};

/** Save the restored-size bounds, so a maximized window comes back maximized
 *  over the same normal frame. */
const saveWindowPlacement = (win: BrowserWindow, writeLog: WriteLog) => {
  const bounds = win.getNormalBounds();
  const state: WindowPlacement = { ...bounds, maximized: win.isMaximized() };
  try {
    // Synchronous: the window is closing and an async write may never finish.
    writeFileSync(windowStatePath(), JSON.stringify(state));
  } catch (error) {
    void writeLog("main", "window state save failed", String(error));
  }
};

export function createWindow({
  preloadPath,
  webviewFindPreloadPath,
  rendererIndexPath,
  iconPath,
  writeLog,
}: CreateWindowOptions): BrowserWindow {
  void writeLog("main", "preload", preloadPath);
  const placement = readWindowPlacement();
  const win = new BrowserWindow({
    ...(placement.x !== undefined && placement.y !== undefined ? { x: placement.x, y: placement.y } : {}),
    width: placement.width,
    height: placement.height,
    title: APP_NAME,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    // Paint before the renderer applies its theme. Follows the OS; a manual
    // renderer theme override takes over once the page loads.
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1b1b1a" : "#f8f8f7",
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

  if (placement.maximized) win.maximize();
  win.on("close", () => saveWindowPlacement(win, writeLog));

  // Third-party pages keep first refusal on Ctrl/Cmd+F. This isolated preload
  // observes the page's DOM cancellation/propagation result and asks the host
  // to open its find bar only when the page did not claim the chord. Keep the
  // bridge main-frame-only: enabling Node preload execution in third-party
  // child frames widens the security boundary and is unnecessary for normal
  // document apps such as Feishu.
  win.webContents.on('will-attach-webview', (_event, webPreferences) => {
    webPreferences.preload = webviewFindPreloadPath;
    webPreferences.contextIsolation = true;
    webPreferences.nodeIntegration = false;
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
