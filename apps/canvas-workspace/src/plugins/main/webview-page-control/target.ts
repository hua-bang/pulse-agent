import { getWebContentsForNode } from '../../../main/webview/registry';
import { ensureOperable } from '../../../main/webview/ensure-operable';
import { activateWorkspaceWindow } from '../../../main/app/window-manager';
import { findDockLinkTab } from '../../../main/dock/tab-actions';
import { evaluateActionPolicy } from './policy';

export interface ResolvedPageControlTarget {
  wc: NonNullable<ReturnType<typeof getWebContentsForNode>>;
  url: string;
}

export async function resolvePageControlTarget(
  workspaceId: string,
  nodeId: string,
): Promise<
  | { ok: true; target: ResolvedPageControlTarget }
  | { ok: false; error: string }
> {
  const dockTab = findDockLinkTab(workspaceId, nodeId);
  const lookup = () => getWebContentsForNode(workspaceId, nodeId);

  // Dock link tab: an inactive pane stays `visibility: hidden` (NOT
  // display:none) so Electron keeps the guest alive and compositing (see
  // RightDock/index.css), and the guest's visibility tracks the embedder
  // window, not the element's CSS (see webview/lifecycle.ts). CDP input and
  // screenshots therefore work on a background tab without bringing it to the
  // front. So an already-mounted webview is operated in place - we do NOT
  // call activateDockTab, which would send dock:activate-tab and steal the
  // user's active dock tab (the "agent keeps jumping me to the web tab"
  // complaint). When the webview isn't mounted (tab never activated, or
  // L3-discarded), refuse rather than auto-switching the user's tab - the
  // agent should canvas_open_tab or ask the user to open it first.
  if (dockTab) {
    const existing = lookup();
    if (existing && !existing.isDestroyed()) {
      const url = existing.getURL();
      const decision = evaluateActionPolicy(url);
      if (!decision.allow) {
        return { ok: false, error: `policy blocked action on ${url}: ${decision.reason}` };
      }
      return { ok: true, target: { wc: existing, url } };
    }
    return {
      ok: false,
      error:
        `No live webview for link tab ${nodeId} in workspace ${workspaceId} ` +
        '(the tab is not mounted or was discarded). ' +
        'Call canvas_open_tab to open it, or ask the user to activate the tab, then retry.',
    };
  }

  // Canvas iframe node: a non-active workspace keeps the canvas `display: none`,
  // which detaches the compositing surface, so operate-mode activation of the
  // workspace is still required. This brings the workspace on-screen
  // (showInactive, no focus steal) but does NOT switch the dock's active tab.
  const wc = await ensureOperable({
    lookup,
    activate: () => activateWorkspaceWindow(workspaceId),
    mode: 'operate',
  });
  if (!wc) {
    return {
      ok: false,
      error:
        `No active webview for node ${nodeId} in workspace ${workspaceId} ` +
        '(auto-activation attempted). Open the iframe node in URL mode and make sure it has finished loading.',
    };
  }
  const url = wc.getURL();
  const decision = evaluateActionPolicy(url);
  if (!decision.allow) {
    return { ok: false, error: `policy blocked action on ${url}: ${decision.reason}` };
  }
  return { ok: true, target: { wc, url } };
}

export function auditPageAction(
  action: string,
  nodeId: string,
  url: string,
  extra: Record<string, unknown> = {},
): void {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    host = '(invalid url)';
  }
  console.info(
    `[webview-action] ${action} node=${nodeId} host=${host} ${JSON.stringify(extra)}`,
  );
}
