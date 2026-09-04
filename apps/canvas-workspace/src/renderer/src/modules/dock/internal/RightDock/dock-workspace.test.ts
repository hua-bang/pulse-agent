import { describe, expect, it } from 'vitest';
import { resolveDockWorkspaceId } from './dock-workspace';

describe('resolveDockWorkspaceId', () => {
  it('uses the Chat session workspace on the full-page Chat route', () => {
    expect(resolveDockWorkspaceId('chat', 'canvas-workspace', 'chat-workspace'))
      .toBe('chat-workspace');
  });

  it('falls back to the active Canvas workspace for global Chat', () => {
    expect(resolveDockWorkspaceId('chat', 'canvas-workspace', null))
      .toBe('canvas-workspace');
  });

  it('ignores retained Chat scope outside the Chat route', () => {
    expect(resolveDockWorkspaceId('canvas', 'canvas-workspace', 'chat-workspace'))
      .toBe('canvas-workspace');
  });
});
