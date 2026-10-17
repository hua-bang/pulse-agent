import { useSyncExternalStore } from 'react';
import type { AgentContextSkillRef } from '../types';

/**
 * The skill the Skills page has open in the dock. The page publishes it and
 * clears it when it unmounts, so the side chat only sees it on that page.
 */
let openSkill: AgentContextSkillRef | null = null;
const listeners = new Set<() => void>();

export const setOpenSkillChatContext = (skill: AgentContextSkillRef | null): void => {
  if (
    openSkill === skill
    || (openSkill && skill && openSkill.path === skill.path && openSkill.name === skill.name)
  ) return;
  openSkill = skill;
  listeners.forEach(listener => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useOpenSkillChatContext = (): AgentContextSkillRef | null => (
  useSyncExternalStore(subscribe, () => openSkill)
);
