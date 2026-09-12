import type { DockPreviewTab, DockState } from './dock-types';
import { CHAT_TAB_ID } from '../../../../shared/dock/dock-tab-ids';

export interface DockTabSwitcherItem {
  id: string;
  title: string;
  kind: 'chat' | 'terminal' | DockPreviewTab['kind'];
  faviconUrl?: string;
  url?: string;
  agentType?: string;
}

interface Labels {
  chatTabEnabled: boolean;
  chatTitle: string;
  terminalTitle: string;
}

/** One visible-tab projection shared by the strip, keyboard cycle and menu. */
export function getDockTabSwitcherItems(
  state: DockState,
  { chatTabEnabled, chatTitle, terminalTitle }: Labels,
): DockTabSwitcherItem[] {
  return [
    ...(chatTabEnabled
      ? [{ id: CHAT_TAB_ID, title: chatTitle, kind: 'chat' as const }]
      : []),
    ...state.terminalTabs.map((tab) => ({
      id: tab.id,
      title: tab.title ?? `${terminalTitle} ${tab.ordinal}`,
      kind: 'terminal' as const,
      ...(tab.agentType ? { agentType: tab.agentType } : {}),
    })),
    ...state.tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      kind: tab.kind,
      ...(tab.kind === 'link' ? { url: tab.url } : {}),
      ...(tab.kind === 'link' && tab.faviconUrl ? { faviconUrl: tab.faviconUrl } : {}),
    })),
  ];
}

export const dockTabDomain = (url?: string): string => {
  if (!url) return '';
  try { return new URL(url).host; } catch { return url; }
};

export const filterDockTabs = (items: readonly DockTabSwitcherItem[], query: string): DockTabSwitcherItem[] => {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(item => terms.every(term => `${item.title} ${item.url ?? ''}`.toLocaleLowerCase().includes(term)));
};
