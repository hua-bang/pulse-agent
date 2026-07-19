import { getWebContentsForNode } from '../../../main/webview/registry';
import { ensureOperable } from '../../../main/webview/ensure-operable';
import { activateWorkspaceWindow } from '../../../main/app/window-manager';
import { activateDockTab, findDockLinkTab } from '../../../main/dock/tab-actions';
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
  const wc = await ensureOperable({
    lookup: () => getWebContentsForNode(workspaceId, nodeId),
    activate: async () => {
      if (!dockTab) return await activateWorkspaceWindow(workspaceId);
      const ok = await activateDockTab(workspaceId, nodeId);
      return ok ? { ok: true } : { ok: false, error: 'Could not activate the dock tab workspace.' };
    },
    mode: 'operate',
  });
  if (!wc) {
    return {
      ok: false,
      error: dockTab
        ? `No active webview for link tab ${nodeId} in workspace ${workspaceId} `
          + '(auto-activation attempted). Make sure the tab is open in the dock and has finished loading.'
        : `No active webview for node ${nodeId} in workspace ${workspaceId} `
          + '(auto-activation attempted). Open the iframe node in URL mode and make sure it has finished loading.',
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
