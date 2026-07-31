import type { DockState } from './dock-types';
import { CHAT_TAB_ID } from './dock-tab-ids';

export interface DockTabSwitcherItem {
  id: string;
  title: string;
  kind: 'chat' | 'terminal' | 'link' | 'content';
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
    ...(chatTabEnabled ? state.terminalTabs : []).map((tab) => ({
      id: tab.id,
      title: tab.title ?? `${terminalTitle} ${tab.ordinal}`,
      kind: 'terminal' as const,
    })),
    ...state.tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      kind: tab.kind === 'link' ? 'link' as const : 'content' as const,
    })),
  ];
}
