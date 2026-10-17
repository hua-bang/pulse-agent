import { useEffect, useState } from 'react';
import { useRightDockState } from '../../../shared/dockPort';
import { setOpenSkillChatContext } from '../../../shared/skillChatContext';

/**
 * Publishes the skill last shown in the dock as side chat context. It stays
 * while its tab is open, also after the user switches to the chat tab, and
 * only counts when it belongs to the library the page shows.
 */
export const usePublishOpenSkill = (workspaceId: string | null) => {
  const { tabs, activeTabId } = useRightDockState();
  const [focusedTabId, setFocusedTabId] = useState<string | null>(null);

  useEffect(() => {
    if (tabs.some(tab => tab.id === activeTabId && tab.kind === 'skill')) setFocusedTabId(activeTabId);
  }, [activeTabId, tabs]);

  const tab = tabs.find(item => item.id === focusedTabId);
  const skill = tab?.kind === 'skill'
    && (tab.scope.level === 'global' || tab.scope.workspaceId === workspaceId)
    ? tab.skill
    : null;

  useEffect(() => {
    setOpenSkillChatContext(skill ? { name: skill.name, scope: skill.scope, path: skill.path } : null);
  }, [skill]);

  useEffect(() => () => setOpenSkillChatContext(null), []);
};
