import type { CanvasConfigScope, CanvasSkillEntry } from '../../../types';

export type ScopeView = 'effective' | 'workspace' | 'global';

export type LibraryContext =
  | { kind: 'global' }
  | { kind: 'workspace'; workspaceId: string };

export type DisplaySkill = CanvasSkillEntry & {
  configScope: CanvasConfigScope;
  overridesGlobal: boolean;
};
