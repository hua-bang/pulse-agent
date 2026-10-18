import { nodeDetailTabId } from '../../../../../shared/dock/dock-tab-ids';
import type { DockPreviewTab, DockState } from './dock-types';

/**
 * Open a node detail tab. A `preview` open (browsing from the graph) reuses
 * the single preview tab in place, so clicking through nodes does not pile up
 * tabs. A plain open keeps the tab: it never replaces, and it clears the
 * preview mark when it lands on the current preview tab.
 */
export function getOpenNodeDetailPatch(
  state: DockState,
  workspaceId: string,
  nodeId: string,
  title: string,
  preview = false,
): Partial<DockState> {
  const id = nodeDetailTabId(workspaceId, nodeId);
  const opened = { activeTabId: id, expanded: true };
  if (state.tabs.some((tab) => tab.id === id)) {
    return {
      tabs: state.tabs.map((tab) => (tab.id === id && tab.kind === 'node-detail'
        ? { ...tab, title, ...(preview ? {} : { preview: undefined }) }
        : tab)),
      ...opened,
    };
  }
  const tab: DockPreviewTab = {
    id,
    kind: 'node-detail',
    title,
    workspaceId,
    nodeId,
    ...(preview ? { preview: true } : {}),
  };
  const previewIndex = preview
    ? state.tabs.findIndex((item) => item.kind === 'node-detail' && item.preview)
    : -1;
  if (previewIndex < 0) return { tabs: [...state.tabs, tab], ...opened };
  const tabs = [...state.tabs];
  tabs[previewIndex] = tab;
  return { tabs, ...opened };
}
