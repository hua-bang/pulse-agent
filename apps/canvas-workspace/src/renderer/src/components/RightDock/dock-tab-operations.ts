import type { DockTerminalWorkspaceState } from './dock-types';

export type DockTabDropPosition = 'before' | 'after';

export const reorderTabs = <T extends { id: string }>(
  tabs: T[],
  sourceId: string,
  targetId: string,
  position: DockTabDropPosition,
): T[] | null => {
  const sourceIndex = tabs.findIndex((tab) => tab.id === sourceId);
  const targetIndex = tabs.findIndex((tab) => tab.id === targetId);
  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return null;

  const next = tabs.filter((tab) => tab.id !== sourceId);
  const targetIndexAfterRemoval = next.findIndex((tab) => tab.id === targetId);
  const insertIndex = targetIndexAfterRemoval + (position === 'after' ? 1 : 0);
  next.splice(insertIndex, 0, tabs[sourceIndex]);
  if (next.every((tab, index) => tab.id === tabs[index]?.id)) return null;
  return next;
};

export const updateTerminalAgentType = (
  workspace: DockTerminalWorkspaceState,
  id: string,
  agentType?: string,
): DockTerminalWorkspaceState | null => {
  const trimmed = agentType?.trim();
  const tab = workspace.tabs.find((item) => item.id === id);
  if (!tab || tab.agentType === trimmed) return null;
  return {
    ...workspace,
    tabs: workspace.tabs.map((item) => {
      if (item.id !== id) return item;
      if (trimmed) return { ...item, agentType: trimmed };
      const { agentType: _removed, ...withoutAgentType } = item;
      return withoutAgentType;
    }),
  };
};
