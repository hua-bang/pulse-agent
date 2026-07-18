/**
 * Main → renderer dock-tab commands, used by Canvas Agent tools to drive the
 * right dock's browser-like tabs (open a URL, bring a tab to the front).
 *
 * Channels (push events subscribed in `RightDock/useDockAgentBridge`; pushes
 * don't appear in describe-canvas's handle↔invoke parity, so this comment is
 * their registry):
 *  - `dock:activate-tab` {workspaceId, tabId} — make the tab the active dock pane
 *  - `dock:open-tab`     {url, tabId?} — open url as a web tab (tabId set →
 *    navigate that existing link tab; renderer falls back to a new tab when
 *    the id is unknown)
 *
 * Events are sent to every live window. Activation carries workspaceId, so a
 * renderer applies it only after that workspace becomes active; open-tab is
 * intentionally app-level and may be consumed by the live dock.
 */
import { BrowserWindow, type WebContents } from 'electron';
import type { AgentContextTabRef } from '../../shared/agent-chat';
import { activateWorkspaceWindow } from '../app/window-manager';
import { getDockTabs } from './tab-store';

function liveWindowContents(): WebContents[] {
  return BrowserWindow.getAllWindows()
    .filter((win) => !win.isDestroyed())
    .map((win) => win.webContents);
}

/** The published link-tab ref for `tabId`, if the workspace's dock has one. */
export function findDockLinkTab(
  workspaceId: string,
  tabId: string,
): AgentContextTabRef | undefined {
  if (!workspaceId || !tabId) return undefined;
  return getDockTabs(workspaceId).find((tab) => tab.kind === 'link' && tab.id === tabId);
}

/** Activate the tab's workspace, then bring the tab to the front. */
export async function activateDockTab(workspaceId: string, tabId: string): Promise<boolean> {
  const activation = await activateWorkspaceWindow(workspaceId);
  if (!activation.ok) return false;
  const targets = liveWindowContents();
  for (const wc of targets) wc.send('dock:activate-tab', { workspaceId, tabId });
  return targets.length > 0;
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
