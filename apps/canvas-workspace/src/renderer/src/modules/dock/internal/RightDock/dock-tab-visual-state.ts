export interface DockTabVisualState {
  focused: boolean;
  selected: boolean;
  splitActive: boolean;
  splitVisible: boolean;
  splitPart: 'left' | 'right' | undefined;
}

export const getDockTabVisualState = (
  tabId: string,
  activePaneId: string | null,
  splitTabIds: Readonly<DockComparisonPair> | undefined,
): DockTabVisualState => {
  const splitActive = Boolean(splitTabIds);
  const splitIndex = splitTabIds?.indexOf(tabId) ?? -1;
  const splitVisible = splitActive && isDockTabPresented(activePaneId, splitTabIds, tabId);
  return {
    focused: tabId === activePaneId,
    selected: tabId === activePaneId || splitVisible,
    splitActive,
    splitVisible,
    splitPart: !splitVisible ? undefined : splitIndex === 0 ? 'left' : 'right',
  };
};
import { isDockTabPresented } from '../../../../shared/dock/dock-split-state';
import type { DockComparisonPair } from './dock-types';
