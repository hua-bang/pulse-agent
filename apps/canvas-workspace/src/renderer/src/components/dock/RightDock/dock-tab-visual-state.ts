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
  splitTabIds: readonly [string, string] | undefined,
): DockTabVisualState => {
  const splitActive = Boolean(splitTabIds);
  const splitIndex = splitTabIds?.indexOf(tabId) ?? -1;
  const splitVisible = splitIndex >= 0;
  return {
    focused: tabId === activePaneId,
    selected: tabId === activePaneId || splitVisible,
    splitActive,
    splitVisible,
    splitPart: !splitVisible ? undefined : splitIndex === 0 ? 'left' : 'right',
  };
};
