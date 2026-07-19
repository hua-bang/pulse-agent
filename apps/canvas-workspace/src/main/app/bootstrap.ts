import { APP_NAME, configureAppIdentity } from "./identity";
import { app, BrowserWindow } from "electron";
import { existsSync } from "fs";
import { join } from "path";
import { setupPtyIpc, killAllPty } from "../terminal/pty-manager";
import { setupScrollbackCapture } from "../terminal/scrollback";
import { setupDockTabsIpc } from "../dock/tab-store";
import { setupBrowsingHistoryIpc } from "../dock/history-store";
import {
  setupCanvasStoreIpc,
  teardownCanvasWatchers,
  auditPollutedWorkspacesAtStartup,
} from "../canvas/store";
import { ensureWelcomeWorkspaceSeeded } from "../canvas/welcome-workspace";
import { setupFileManagerIpc } from "../files/manager";
// MCP server disabled: canvas-cli is the preferred agent interface now.
// import { startMCPServer } from "../runtime/mcp-server";
// import { ensureMCPRegistered } from "../runtime/mcp-registration";
import { setupFileWatcherIpc, teardownFileWatcher } from "../files/watcher";
import {
  getCanvasAgentService,
  setupCanvasAgentIpc,
  teardownCanvasAgent,
} from "../agent/ipc";
import { setupCodexSessionsIpc } from "../agent/codex-sessions";
import { setupCanvasModelIpc } from "../agent/model/ipc";
import { setupCanvasSkillsIpc } from "../agent/skills/ipc";
import { setupCanvasMcpIpc } from "../agent/mcp/ipc";
import { ensureDefaultSkillsSeeded } from "../agent/default-skills";
import { setupCanvasPromptIpc } from "../agent/prompt-profile-ipc";
import { setupBuiltInToolsConfigIpc } from "../settings/built-in-tools-ipc";
import { applyStoredBuiltInToolsConfigToEnv } from "../settings/built-in-tools-config";
import { setupCanvasPluginsConfigIpc } from "../settings/canvas-plugins-ipc";
import { getExperimentalFlagSync, setupExperimentalIpc } from "../settings/experimental-ipc";
import {
  EXPERIMENTAL_FLAG_AGENT_TEAMS,
  EXPERIMENTAL_FLAG_DEFAULT_BROWSER,
} from "../../shared/experimental-features";
import { setupWebviewRegistryIpc } from "../webview/registry";
import { startWebviewDiscardMonitor } from "../webview/discard-monitor";
import { setupHtmlGeneratorIpc } from "../generation/ipc";
import { setupWebpageReaderIpc } from "../webview/reader";
import { setupArtifactIpc } from "../artifacts/ipc";
import { setupShellIpc } from "./shell-ipc";
import {
  BUILT_IN_MAIN_PLUGINS,
  reloadConfiguredExternalMainPlugins,
  setupCanvasPlugins,
  teardownCanvasPlugins,
  setAgentServiceAccessor,
} from "../../plugins/main";
import { applyChannelConfigToEnv } from "../../plugins/main/channel/config";
import { setupChannelConfigIpc } from "../../plugins/main/channel/config-ipc";
import {
  createMainLogger,
  setupFatalErrorLogging,
  setupRendererLogIpc,
  type WriteLog,
} from "./logging";
import {
  registerPulseCanvasProtocol,
  registerPulseCanvasSchemesAsPrivileged,
} from "./protocol";
import { logStartupSummaryOnce, startupMark } from "./startup-metrics";
import { startLoopDelaySampler } from "../perf/loop-delay";
import { createWindow } from "./window";
import { setWindowFactory } from "./window-manager";
import { setupLinkPolicy } from "./link-policy";
import { setupGoogleAuthCompat } from "./google-auth";
import { setupDeepLinkEarly } from "../default-browser/deep-link";
import { setupDefaultBrowserIpc } from "../default-browser/ipc";

export interface BootstrapOptions {
  mainDir: string;
}

interface AppPaths {
  preloadPath: string;
  rendererIndexPath: string;
  iconPath?: string;
}

async function ensureRuntimeControlServer(writeLog: WriteLog): Promise<boolean> {
  const runtime = await import('../runtime/control-server');
  return runtime.ensureRuntimeControlServer((message, detail) => {
    void writeLog('main', message, detail);
  });
}

async function stopRuntimeControlServer(): Promise<void> {
  const runtime = await import('../runtime/control-server');
  await runtime.stopRuntimeControlServer();
}

export function bootstrap({ mainDir }: BootstrapOptions): void {
  // Keep identity configured even when tests import bootstrap directly instead
  // of going through the main entry module.
  configureAppIdentity();

  const paths = resolveAppPaths(mainDir);
  const { writeLog } = createMainLogger();

  registerPulseCanvasSchemesAsPrivileged();
  setupLinkPolicy();

  // Default-browser support (single-instance lock + OS deep-link listeners)
  // is opt-in behind the "Set as default browser" experimental flag, and MUST
  // be wired before whenReady. Only when the flag is on do we acquire the
  // single-instance lock (a second instance — e.g. an OS link activation on
  // Win/Linux — hands its URL to the running process and quits). With the flag
  // OFF (the default, and every normal/dev launch) we install NOTHING here, so
  // there is no lock and no behaviour change. Takes effect on the next app
  // start after the flag is toggled.
  if (getExperimentalFlagSync(EXPERIMENTAL_FLAG_DEFAULT_BROWSER)) {
    if (!setupDeepLinkEarly(writeLog)) return;
  }

  app.whenReady().then(async () => {
    startupMark("whenReady");
    startLoopDelaySampler(writeLog);
    spoofUserAgentFallback();
    setupGoogleAuthCompat();
    registerPulseCanvasProtocol(writeLog);
    configureAppChrome(paths.iconPath, writeLog);
    // Must run before the window opens: the default menu's Undo/Redo
    // accelerators would otherwise swallow Cmd/Ctrl+Z before the
    // renderer's canvas-history handler receives the keydown.
    const { configureApplicationMenu } = await import('./menu');
    configureApplicationMenu();
    setupRendererLogIpc(writeLog);
    setupFatalErrorLogging(writeLog);

    setupPtyIpc();
    setupScrollbackCapture();
    setupDockTabsIpc();
    setupBrowsingHistoryIpc();
    setupCanvasStoreIpc();
    try {
      await ensureWelcomeWorkspaceSeeded();
    } catch (err) {
      await writeLog("main", "ensureWelcomeWorkspaceSeeded failed", String(err));
    }
    startupMark("welcomeSeeded");
    // Audit pollution-shaped workspaces in the background; surfaces a log
    // entry per finding. The renderer's MigrationSpinner separately
    // surfaces user-visible sticky alerts via canvas:listPollutedWorkspaces
    // when it mounts.
    void auditPollutedWorkspacesAtStartup();
    setupFileManagerIpc();
    setupFileWatcherIpc();
    const {
      ensureAgentToolingAtStartup,
      setupSkillInstallerIpc,
    } = await import("../files/skill-installer");
    setupSkillInstallerIpc();
    await ensureAgentToolingAtStartup(writeLog);
    setupCanvasAgentIpc();
    setupCodexSessionsIpc();
    if (getExperimentalFlagSync(EXPERIMENTAL_FLAG_AGENT_TEAMS)) {
      const { setupAgentTeamsRuntime } = await import('../agent-teams/runtime');
      setupAgentTeamsRuntime(
        () => BrowserWindow.getAllWindows(),
        (message, detail) => { void writeLog('agent-teams', message, detail); },
      );
    }
    setupCanvasModelIpc();
    setupCanvasSkillsIpc();
    setupCanvasMcpIpc();
    setupBuiltInToolsConfigIpc();
    setupCanvasPluginsConfigIpc();
    await applyStoredBuiltInToolsConfigToEnv();
    // Seed the meta-skills (save-as-skill, promote-skill) into the global
    // scope on first start. Idempotent — user edits are preserved.
    void ensureDefaultSkillsSeeded().catch((err) => {
      void writeLog("main", "ensureDefaultSkillsSeeded failed", String(err));
    });
    setupCanvasPromptIpc();
    setupExperimentalIpc();
    setupWebviewRegistryIpc();
    // L3 of the webview lifecycle: budget-driven discard of long-frozen
    // guests (Memory Saver style — see main/webview/discard-monitor.ts).
    // App-lifetime service; the interval dies with the process.
    startWebviewDiscardMonitor();
    setupHtmlGeneratorIpc();
    const [{ setupWorkspaceNodeIpc }, { setupUpdateIpc }] = await Promise.all([
      import('../canvas/nodes/ipc'),
      import('./update-ipc'),
    ]);
    setupArtifactIpc();
    setupShellIpc();
    setupDefaultBrowserIpc();
    setupUpdateIpc();
    setupWebpageReaderIpc();
    setupWorkspaceNodeIpc();
    // Channel credentials: register the config IPC (independent of the
    // plugin) and fold any stored config into process.env BEFORE plugins
    // evaluate enabledWhen, so a UI-configured channel can activate.
    setupChannelConfigIpc();
    applyChannelConfigToEnv();
    // Let plugins reach the Canvas Agent service singleton (e.g. the channel
    // plugin drives conversations from external chat). Inject before
    // activation so getAgentService() is available in activate().
    setAgentServiceAccessor(() => getCanvasAgentService());
    // Plugin activation can register canvas-agent tools; we need that done
    // BEFORE any canvas-agent is constructed (which happens when the
    // renderer first calls into canvas-agent IPC). Await so the registry
    // is fully populated by the time the window comes up.
    startupMark("ipcWired");
    await setupCanvasPlugins(BUILT_IN_MAIN_PLUGINS);
    await reloadConfiguredExternalMainPlugins();
    startupMark("pluginsActivated");
    void ensureRuntimeControlServer(writeLog).then((ok) => {
      if (!ok) {
        void writeLog(
          "main",
          "runtime-control-server unavailable",
          "live agent/team commands will fail until Pulse Canvas is restarted"
        );
      }
    });
    // MCP server disabled: canvas-cli is the preferred agent interface now.
    // startMCPServer();
    // void ensureMCPRegistered();

    const openWindow = () =>
      createWindow({
        preloadPath: paths.preloadPath,
        rendererIndexPath: paths.rendererIndexPath,
        iconPath: paths.iconPath,
        writeLog,
      });

    // Let on-demand activation (e.g. the channel plugin's /open) recreate the
    // window if it was closed.
    setWindowFactory(openWindow);
    // Startup metrics: dom-ready on the first window closes the boot
    // critical path (whenReady → seeding → IPC → plugins → window → renderer).
    app.on("browser-window-created", (_event, win) => {
      win.webContents.once("dom-ready", () => {
        startupMark("rendererDomReady");
        logStartupSummaryOnce(writeLog);
      });
    });
    startupMark("openWindow");
    openWindow();

    app.on("activate", () => {
      // Reopening the window after a close must restore the live channel too —
      // on macOS the process stays alive but the server was previously torn
      // down here, leaving "app open but no runtime" (ENOENT for CLI live cmds).
      void ensureRuntimeControlServer(writeLog);
      if (BrowserWindow.getAllWindows().length === 0) {
        openWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    killAllPty();
    teardownFileWatcher();
    teardownCanvasWatchers();
    teardownCanvasAgent();
    void teardownCanvasPlugins();
    if (process.platform !== "darwin") {
      // Only on platforms where closing all windows quits the app do we tear
      // down the runtime server. On macOS the process keeps running in the
      // dock, so the server must stay up so live commands keep working after
      // the window is reopened. (will-quit handles the real shutdown.)
      void stopRuntimeControlServer();
      app.quit();
    }
  });
}

function resolveAppPaths(mainDir: string): AppPaths {
  const preloadPath = join(mainDir, "../preload/index.mjs");
  const preloadFallbackPath = join(mainDir, "../preload/index.js");
  const resolvedPreloadPath = existsSync(preloadPath)
    ? preloadPath
    : preloadFallbackPath;

  // Resolve the app icon for window/taskbar display. Works in dev, preview,
  // and packaged builds (resources/ is shipped via electron-builder files).
  const iconCandidates = [
    join(mainDir, "../../resources/icon.png"),
    join(mainDir, "../../build/icon.png"),
    join(process.resourcesPath ?? "", "resources/icon.png"),
  ];

  return {
    preloadPath: resolvedPreloadPath,
    rendererIndexPath: join(mainDir, "../renderer/index.html"),
    iconPath: iconCandidates.find((p) => p && existsSync(p)),
  };
}

function spoofUserAgentFallback(): void {
  // Notion (and a handful of other services) reject embedded <webview>s on two
  // grounds: the UA string contains the Electron token, and the Chrome major
  // version bundled with Electron 30 is now below their supported floor. Strip
  // the Electron / product-name tokens and rewrite the Chrome version to a
  // recent stable release so each webContents looks like current stock Chrome.
  //
  // This UA-string rewrite is NOT enough for Google sign-in: Chromium still
  // emits UA Client Hints derived from the real bundled version, and
  // accounts.google.com rejects the mismatch. google-auth.ts layers a
  // Firefox identity over Google's auth hosts to close that gap.
  const SPOOFED_CHROME_MAJOR = "140";
  app.userAgentFallback = app.userAgentFallback
    .replace(/\s?Electron\/\S+/g, "")
    .replace(/\s?PulseCanvas\/\S+/g, "")
    .replace(
      /Chrome\/\d+(?:\.\d+){0,3}/g,
      `Chrome/${SPOOFED_CHROME_MAJOR}.0.0.0`
    );
}

function configureAppChrome(
  iconPath: string | undefined,
  writeLog: WriteLog
): void {
  // Set the macOS dock icon in dev/preview. Packaged builds should keep using
  // the bundle .icns from electron-builder so the launch and running Dock icon
  // stay visually consistent.
  if (process.platform === "darwin" && !app.isPackaged && iconPath && app.dock) {
    try {
      app.dock.setIcon(iconPath);
    } catch (error) {
      void writeLog("main", "dock.setIcon failed", String(error));
    }
  }

  // About panel: shown by the native menu. iconPath is honored on Linux and
  // Windows; macOS reads the icon from the app bundle.
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    copyright: "Copyright © 2025",
    ...(iconPath ? { iconPath } : {})
  });
}
