import { CHAT_TAB_ID } from './dock-tab-ids';
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

/**
 * Whether this task's conversation is the thing the user is looking at right
 * now. `Run now` opens exactly this surface and then waits out the whole run,
 * so a completion toast raised on top of it announces a result already on
 * screen and its action points at the open panel.
 *
 * Being pointed at the task is not enough — a collapsed dock, or one showing a
 * link/terminal tab, keeps `scheduledChatTaskId` set while the conversation is
 * invisible.
 */
export function isScheduledChatVisible(state: DockState, taskId: string): boolean {
  return state.expanded
    && state.activeTabId === CHAT_TAB_ID
    && state.scheduledChatTaskId === taskId;
}
