import { describe, expect, it } from 'vitest';
import { resolveDockWorkspaceId } from './dock-workspace';

describe('resolveDockWorkspaceId', () => {
  it('uses the Chat session workspace on the full-page Chat route', () => {
    expect(resolveDockWorkspaceId('chat', 'canvas-workspace', 'chat-workspace'))
      .toBe('chat-workspace');
  });

  it('uses an independent Global session regardless of the Canvas workspace', () => {
    expect(resolveDockWorkspaceId('chat', 'canvas-workspace', null)).toBe('__global_chat__');
    expect(resolveDockWorkspaceId('chat', 'other-canvas', null)).toBe('__global_chat__');
  });

  it('ignores retained Chat scope outside the Chat route', () => {
    expect(resolveDockWorkspaceId('canvas', 'canvas-workspace', 'chat-workspace'))
      .toBe('canvas-workspace');
  });
});
