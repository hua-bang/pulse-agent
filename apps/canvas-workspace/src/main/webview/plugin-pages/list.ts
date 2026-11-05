import { listRegisteredWebviews } from '../registry';
import {
  PLUGIN_PAGE_WORKSPACE_ID,
  parsePluginPageTargetId,
} from '../../../shared/webview-registration';

/** A plugin page that is open now. `nodeId` is the id the page read tools take. */
export interface OpenPluginPage {
  nodeId: string;
  pluginId: string;
  viewId: string;
  title: string;
  url: string;
}

/**
 * Plugin pages whose host `WebView` is mounted. A plugin page unmounts when
 * the user leaves its route, so this list is what the user has open now.
 * Plugin pages belong to the app, so the list does not depend on a workspace.
 */
export function listOpenPluginPages(): OpenPluginPage[] {
  const pages: OpenPluginPage[] = [];
  for (const entry of listRegisteredWebviews()) {
    if (entry.workspaceId !== PLUGIN_PAGE_WORKSPACE_ID) continue;
    const target = parsePluginPageTargetId(entry.nodeId);
    if (!target) continue;
    pages.push({
      nodeId: entry.nodeId,
      ...target,
      title: entry.wc.getTitle(),
      url: entry.wc.getURL(),
    });
  }
  return pages;
}
