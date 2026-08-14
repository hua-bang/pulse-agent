import { describe, expect, it } from 'vitest';
import { dockScopeKey, GLOBAL_DOCK_SCOPE_KEY, resolveDockScope } from './dock-workspace';

describe('resolveDockScope', () => {
  it('uses the Chat session workspace on the full-page Chat route', () => {
    expect(resolveDockScope('chat', 'canvas-workspace', {
      kind: 'workspace', workspaceId: 'chat-workspace',
    })).toEqual({ kind: 'workspace', workspaceId: 'chat-workspace' });
  });

  it('uses the workspace-independent Dock scope for global Chat', () => {
    const scope = resolveDockScope('chat', 'canvas-workspace', { kind: 'global' });
    expect(scope).toEqual({ kind: 'global' });
    expect(dockScopeKey(scope)).toBe(GLOBAL_DOCK_SCOPE_KEY);
  });

  it('uses the same workspace-independent Dock scope for scheduled Chat', () => {
    const scope = resolveDockScope('scheduled-task', 'canvas-workspace', {
      kind: 'scheduled', taskId: 'task-1',
    });
    expect(scope).toEqual({ kind: 'global' });
    expect(dockScopeKey(scope)).toBe(GLOBAL_DOCK_SCOPE_KEY);
  });

  it('ignores retained Chat scope outside the Chat route', () => {
    expect(resolveDockScope('canvas', 'canvas-workspace', {
      kind: 'workspace', workspaceId: 'chat-workspace',
    })).toEqual({ kind: 'workspace', workspaceId: 'canvas-workspace' });
  });
});
