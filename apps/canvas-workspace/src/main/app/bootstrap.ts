import { APP_NAME, configureAppIdentity } from "./identity";
import { app, BrowserWindow } from "electron";
import { existsSync } from "fs";
import { join } from "path";
import { setupPtyIpc, killAllPty } from "../terminal/pty-manager";
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
import { setupSkillInstallerIpc } from "../files/skill-installer";
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
import { EXPERIMENTAL_FLAG_AGENT_TEAMS } from "../../shared/experimental-features";
import { setupWebviewRegistryIpc } from "../webview/registry";
import { startWebviewDiscardMonitor } from "../webview/discard-monitor";
import { setupHtmlGeneratorIpc } from "../generation/ipc";
import { setupArtifactIpc } from "../artifacts/ipc";
import { setupShellIpc } from "./shell-ipc";
import { setupUpdateIpc } from "./update-ipc";
import { setupWebpageReaderIpc } from "../webview/reader";
import { setupWorkspaceNodeIpc } from "../canvas/nodes/ipc";
import {
  ensureRuntimeControlServer,
  stopRuntimeControlServer,
} from "../runtime/control-server";
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
import { configureApplicationMenu } from "./menu";
import { logStartupSummaryOnce, startupMark } from "./startup-metrics";
import { startLoopDelaySampler } from "../perf/loop-delay";
import { createWindow } from "./window";
import { setWindowFactory } from "./window-manager";
import { setupLinkPolicy } from "./link-policy";
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

export function bootstrap({ mainDir }: BootstrapOptions): void {
  // Keep identity configured even when tests import bootstrap directly instead
  // of going through the main entry module.
  configureAppIdentity();

  const paths = resolveAppPaths(mainDir);
  const { writeLog } = createMainLogger();

  registerPulseCanvasSchemesAsPrivileged();
  setupLinkPolicy();

  // Single-instance lock + OS deep-link listeners MUST be wired before
  // whenReady. A second instance (e.g. an OS link activation on Win/Linux)
  // hands its URL to the running process and quits; stop bootstrapping here.
  if (!setupDeepLinkEarly(writeLog)) return;

  app.whenReady().then(async () => {
    startupMark("whenReady");
    startLoopDelaySampler(writeLog);
    spoofUserAgentFallback();
    registerPulseCanvasProtocol(writeLog);
    configureAppChrome(paths.iconPath, writeLog);
    // Must run before the window opens: the default menu's Undo/Redo
    // accelerators would otherwise swallow Cmd/Ctrl+Z before the
    // renderer's canvas-history handler receives the keydown.
    configureApplicationMenu();
    setupRendererLogIpc(writeLog);
    setupFatalErrorLogging(writeLog);

    setupPtyIpc();
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
    setupSkillInstallerIpc();
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
    void ensureRuntimeControlServer((message, detail) => {
      void writeLog("main", message, detail);
    }).then((ok) => {
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
      void ensureRuntimeControlServer((message, detail) => {
        void writeLog("main", message, detail);
      });
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
