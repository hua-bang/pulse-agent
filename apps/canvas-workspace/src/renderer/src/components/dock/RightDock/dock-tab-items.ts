import type { DockPreviewTab, DockState } from './dock-types';
import { CHAT_TAB_ID } from './dock-tab-ids';

export interface DockTabSwitcherItem {
  id: string;
  title: string;
  kind: 'chat' | 'terminal' | DockPreviewTab['kind'];
  faviconUrl?: string;
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
      ...(tab.kind === 'link' && tab.faviconUrl ? { faviconUrl: tab.faviconUrl } : {}),
    })),
  ];
}
