import { mcpAppTabId } from './dock-tab-ids';
import type { DockState } from './dock-types';

export function getOpenMcpAppPatch(
  state: DockState,
  instanceId: string,
  title: string,
): Partial<DockState> {
  const id = mcpAppTabId(instanceId);
  const existing = state.tabs.some(tab => tab.id === id);
  return {
    tabs: existing
      ? state.tabs.map(tab => tab.id === id ? { ...tab, title } : tab)
      : [...state.tabs, { id, kind: 'mcp-app', title, instanceId }],
    activeTabId: id,
    expanded: true,
  };
}
