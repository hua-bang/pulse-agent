import { app, BrowserWindow } from "electron";
import { existsSync } from "fs";
import { join } from "path";
import { setupPtyIpc, killAllPty } from "../terminal/pty-manager";
import {
  setupCanvasStoreIpc,
  teardownCanvasWatchers,
  auditPollutedWorkspacesAtStartup,
} from "../canvas/store";
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
import { setupCanvasModelIpc } from "../agent/model/ipc";
import { setupCanvasSkillsIpc } from "../agent/skills/ipc";
import { setupCanvasMcpIpc } from "../agent/mcp/ipc";
import { ensureDefaultSkillsSeeded } from "../agent/default-skills";
import { setupCanvasPromptIpc } from "../agent/prompt-profile-ipc";
import { setupExperimentalIpc } from "../settings/experimental-ipc";
import { setupWebviewRegistryIpc } from "../webview/registry";
import { setupHtmlGeneratorIpc } from "../generation/ipc";
import { setupArtifactIpc } from "../artifacts/ipc";
import { setupShellIpc } from "./shell-ipc";
import { setupWebpageReaderIpc } from "../webview/reader";
import { setupWorkspaceNodeIpc } from "../canvas/nodes/ipc";
import {
  startRuntimeControlServer,
  stopRuntimeControlServer,
} from "../runtime/control-server";
import {
  BUILT_IN_MAIN_PLUGINS,
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
import { createWindow } from "./window";
import { setWindowFactory } from "./window-manager";
import { setupLinkPolicy } from "./link-policy";

export interface BootstrapOptions {
  mainDir: string;
}

interface AppPaths {
  preloadPath: string;
  rendererIndexPath: string;
  iconPath?: string;
}

export function bootstrap({ mainDir }: BootstrapOptions): void {
  // Without this, dev runs inherit the Electron binary's identity — dock label,
  // About panel, userData path, and `ps`/Activity Monitor all read "Electron".
  // Packaged builds get this from electron-builder's productName, but dev does
  // not, so set it explicitly before any other Electron API touches app.name.
  app.setName("Pulse Canvas");
  process.title = "Pulse Canvas";

  const paths = resolveAppPaths(mainDir);
  const { writeLog } = createMainLogger();

  registerPulseCanvasSchemesAsPrivileged();
  setupLinkPolicy();

  app.whenReady().then(async () => {
    spoofUserAgentFallback();
    registerPulseCanvasProtocol(writeLog);
    configureAppChrome(paths.iconPath, writeLog);
    setupRendererLogIpc(writeLog);
    setupFatalErrorLogging(writeLog);

    setupPtyIpc();
    setupCanvasStoreIpc();
    // Audit pollution-shaped workspaces in the background; surfaces a log
    // entry per finding. The renderer's MigrationSpinner separately
    // surfaces user-visible sticky alerts via canvas:listPollutedWorkspaces
    // when it mounts.
    void auditPollutedWorkspacesAtStartup();
    setupFileManagerIpc();
    setupFileWatcherIpc();
    setupSkillInstallerIpc();
    setupCanvasAgentIpc();
    setupCanvasModelIpc();
    setupCanvasSkillsIpc();
    setupCanvasMcpIpc();
    // Seed the meta-skills (save-as-skill, promote-skill) into the global
    // scope on first start. Idempotent — user edits are preserved.
    void ensureDefaultSkillsSeeded().catch((err) => {
      void writeLog("main", "ensureDefaultSkillsSeeded failed", String(err));
    });
    setupCanvasPromptIpc();
    setupExperimentalIpc();
    setupWebviewRegistryIpc();
    setupHtmlGeneratorIpc();
    setupArtifactIpc();
    setupShellIpc();
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
    await setupCanvasPlugins(BUILT_IN_MAIN_PLUGINS);
    void startRuntimeControlServer().catch((err) => {
      void writeLog(
        "main",
        "runtime-control-server failed to start",
        String(err)
      );
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
    openWindow();

    app.on("activate", () => {
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
    void stopRuntimeControlServer();
    if (process.platform !== "darwin") {
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
  // Set the macOS dock icon in dev/preview. Packaged builds use the .icns from
  // electron-builder, so this is a no-op there.
  if (process.platform === "darwin" && iconPath && app.dock) {
    try {
      app.dock.setIcon(iconPath);
    } catch (error) {
      void writeLog("main", "dock.setIcon failed", String(error));
    }
  }

  // About panel: shown by the native menu. iconPath is honored on Linux and
  // Windows; macOS reads the icon from the app bundle.
  app.setAboutPanelOptions({
    applicationName: "Pulse Canvas",
    applicationVersion: app.getVersion(),
    copyright: "Copyright © 2025",
    ...(iconPath ? { iconPath } : {})
  });
}
