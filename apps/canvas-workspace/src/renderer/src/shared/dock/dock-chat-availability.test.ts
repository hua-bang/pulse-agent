import { describe, expect, it } from 'vitest';
import {
  isCanvasTabEditingAllowed,
  isDockChatTabEnabled,
  isGlobalChatLauncherVisible,
} from './dock-chat-availability';

describe('dock chat availability', () => {
  it('hides the dock chat tab only where a full-page chat owns the surface', () => {
    expect(isDockChatTabEnabled('chat')).toBe(false);
    expect(isDockChatTabEnabled('scheduled-task')).toBe(false);
    expect(isDockChatTabEnabled('canvas')).toBe(true);
    expect(isDockChatTabEnabled('scheduled')).toBe(true);
  });

  it('shows the Pulse launcher on every route that has a dock chat tab but no chat chrome of its own', () => {
    // Scheduled used to be excluded by hand, leaving the page with no way in.
    expect(isGlobalChatLauncherVisible('scheduled')).toBe(true);
    expect(isGlobalChatLauncherVisible('nodes')).toBe(true);
    expect(isGlobalChatLauncherVisible('graph')).toBe(true);
    expect(isGlobalChatLauncherVisible('skills')).toBe(true);
  });

  it('keeps the launcher off canvas (own chrome) and off full-page chats (no dock tab)', () => {
    expect(isGlobalChatLauncherVisible('canvas')).toBe(false);
    expect(isGlobalChatLauncherVisible('chat')).toBe(false);
    expect(isGlobalChatLauncherVisible('scheduled-task')).toBe(false);
  });

  it('allows dock canvas editing only on the dedicated AI Chat page', () => {
    expect(isCanvasTabEditingAllowed('chat')).toBe(true);
    for (const view of ['canvas', 'scheduled-task', 'scheduled', 'nodes', 'skills', '/plugin']) {
      expect(isCanvasTabEditingAllowed(view)).toBe(false);
    }
  });
});
