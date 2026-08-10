import type { CanvasConfigScope, CanvasSkillEntry } from '../../../types';
import { skillTabId } from './dock-tab-ids';
import type { DockPreviewTab } from './dock-types';

export const openSkillTab = (
  tabs: DockPreviewTab[],
  scope: CanvasConfigScope,
  skill: CanvasSkillEntry,
): { tabs: DockPreviewTab[]; activeTabId: string } => {
  const scopeKey = scope.level === 'workspace' ? scope.workspaceId : 'global';
  const id = skillTabId(scopeKey, skill.name);
  const tab: DockPreviewTab = { id, kind: 'skill', title: skill.name, scope, skill };
  return {
    tabs: tabs.some((item) => item.id === id)
      ? tabs.map((item) => (item.id === id ? tab : item))
      : [...tabs, tab],
    activeTabId: id,
  };
};
