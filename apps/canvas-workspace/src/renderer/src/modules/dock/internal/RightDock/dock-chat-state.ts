import { CHAT_TAB_ID } from '../../../../shared/dock/dock-tab-ids';
import type { DockState } from './dock-types';

type DockStatePatch = Partial<DockState> | undefined;

export function getOpenChatPatch(state: DockState): DockStatePatch {
  if (
    state.expanded
    && state.activeTabId === CHAT_TAB_ID
    && !state.chatUnread
    && !state.scheduledChatTaskId
  ) return undefined;
  return {
    expanded: true,
    activeTabId: CHAT_TAB_ID,
    chatUnread: false,
    scheduledChatTaskId: undefined,
  };
}

export function getOpenScheduledChatPatch(state: DockState, taskId: string): DockStatePatch {
  if (!taskId) return undefined;
  return {
    expanded: true,
    activeTabId: CHAT_TAB_ID,
    chatUnread: false,
    scheduledChatTaskId: taskId,
    scheduledChatRevision: (state.scheduledChatRevision ?? 0) + 1,
  };
}

export function getRefreshScheduledChatPatch(state: DockState, taskId: string): DockStatePatch {
  if (state.scheduledChatTaskId !== taskId) return undefined;
  return { scheduledChatRevision: (state.scheduledChatRevision ?? 0) + 1 };
}
