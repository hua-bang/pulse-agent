/**
 * Main → renderer dock-tab commands, used by Canvas Agent tools to drive the
 * right dock's browser-like tabs (open a URL, bring a tab to the front).
 *
 * Channels (push events subscribed in `RightDock/useDockAgentBridge`; pushes
 * don't appear in describe-canvas's handle↔invoke parity, so this comment is
 * their registry):
 *  - `dock:activate-tab` {requestId, workspaceId, tabId} — make the tab the active dock pane
 *  - `dock:tab-activation-result` {requestId, workspaceId, tabId, ok, error?}
 *    — renderer acknowledgement after the state change is observable
 *  - `dock:open-tab`     {url, tabId?} — open url as a web tab (tabId set →
 *    navigate that existing link tab; renderer falls back to a new tab when
 *    the id is unknown)
 *  - `dock:open-artifact` {workspaceId, artifactId} — open an artifact as the
 *    active dock pane (workspaceId here is the artifact's STORAGE scope —
 *    including the `__global_chat__` sentinel — not a routing constraint)
 *
 * Events are sent to every live window. Activation carries workspaceId, so a
 * renderer applies it only after that workspace becomes active; open-tab and
 * open-artifact are intentionally app-level and may be consumed by the live dock.
 */
import { BrowserWindow, ipcMain, type WebContents } from 'electron';
import type { AgentContextTabRef } from '../../shared/agent-chat';
import type {
  DockActivateTabRequest,
  DockActivateTabResult,
} from '../../shared/dock-tab-commands';
import { getDockTabs, getGlobalDockTabWorkspaceId } from './tab-store';

const TAB_ACTIVATION_TIMEOUT_MS = 3_000;
let activationSequence = 0;

interface PendingTabActivation {
  targetIds: Set<number>;
  respondedIds: Set<number>;
  resolve: (ok: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const pendingTabActivations = new Map<string, PendingTabActivation>();

function liveWindowContents(): WebContents[] {
  return BrowserWindow.getAllWindows()
    .filter((win) => !win.isDestroyed())
    .map((win) => win.webContents);
}

function finishTabActivation(requestId: string, ok: boolean): void {
  const pending = pendingTabActivations.get(requestId);
  if (!pending) return;
  pendingTabActivations.delete(requestId);
  clearTimeout(pending.timeout);
  pending.resolve(ok);
}

/** Register the renderer acknowledgement lane for `activateDockTab`. */
export function setupDockTabActionsIpc(): void {
  ipcMain.on('dock:tab-activation-result', (event, result: DockActivateTabResult) => {
    if (!result?.requestId) return;
    const pending = pendingTabActivations.get(result.requestId);
    if (!pending || !pending.targetIds.has(event.sender.id)) return;
    if (result.ok) {
      finishTabActivation(result.requestId, true);
      return;
    }
    pending.respondedIds.add(event.sender.id);
    if (pending.respondedIds.size >= pending.targetIds.size) {
      finishTabActivation(result.requestId, false);
    }
  });
}

/** The published link-tab ref for `tabId`, if the workspace's dock has one. */
export function findDockLinkTab(
  workspaceId: string,
  tabId: string,
): AgentContextTabRef | undefined {
  if (!workspaceId || !tabId) return undefined;
  return getDockTabs(workspaceId).find((tab) => tab.kind === 'link' && tab.id === tabId);
}

/**
 * Bring a tab to the front without navigating the host route. The renderer
 * owns workspace selection and acknowledges only after the requested tab is
 * observably active, so a stale id cannot be reported as success.
 */
export async function activateDockTab(workspaceId: string, tabId: string): Promise<boolean> {
  const targets = liveWindowContents();
  if (targets.length === 0) return false;
  activationSequence += 1;
  const request: DockActivateTabRequest = {
    requestId: `dock-activate-${Date.now()}-${activationSequence}`,
    workspaceId,
    tabId,
  };
  const result = new Promise<boolean>((resolve) => {
    const timeout = setTimeout(
      () => finishTabActivation(request.requestId, false),
      TAB_ACTIVATION_TIMEOUT_MS,
    );
    pendingTabActivations.set(request.requestId, {
      targetIds: new Set(targets.map((wc) => wc.id)),
      respondedIds: new Set(),
      resolve,
      timeout,
    });
  });
  for (const wc of targets) wc.send('dock:activate-tab', request);
  return await result;
}

/** Activate a global link tab without asking the caller for its mount route. */
export async function activateGlobalDockTab(tabId: string): Promise<boolean> {
  const workspaceId = getGlobalDockTabWorkspaceId(tabId);
  return workspaceId ? activateDockTab(workspaceId, tabId) : false;
}

/**
 * Open `url` in the right dock — as a new (or URL-deduped existing) web tab,
 * or by navigating the existing link tab `tabId`. Returns false when no
 * window is open to receive the command.
 */
export function openDockTab(url: string, tabId?: string): boolean {
  const targets = liveWindowContents();
  for (const wc of targets) {
    wc.send('dock:open-tab', { url, ...(tabId ? { tabId } : {}) });
  }
  return targets.length > 0;
}

/**
 * Open an artifact as the active dock pane. App-level like open-tab; the
 * dock's artifact viewer fetches by (workspaceId, artifactId), so the global
 * `__global_chat__` artifact scope works from any route. Returns false when
 * no window is open to receive the command.
 */
export function openDockArtifact(workspaceId: string, artifactId: string): boolean {
  if (!workspaceId || !artifactId) return false;
  const targets = liveWindowContents();
  for (const wc of targets) {
    wc.send('dock:open-artifact', { workspaceId, artifactId });
  }
  return targets.length > 0;
}
