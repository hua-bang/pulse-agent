import { describe, expect, it } from 'vitest';
import { chatScopeKey, createChatPageSessionTarget, scopeFromSessionStoreId } from './sessionScope';

describe('scopeFromSessionStoreId', () => {
  it('keeps workspace, global, and scheduled session ownership distinct', () => {
    expect(scopeFromSessionStoreId('workspace-1')).toEqual({
      kind: 'workspace',
      workspaceId: 'workspace-1',
    });
    expect(scopeFromSessionStoreId('__global_chat__')).toEqual({ kind: 'global' });
    expect(scopeFromSessionStoreId('__scheduled__-task-1')).toEqual({
      kind: 'scheduled',
      taskId: 'task-1',
    });
  });

  it('creates a full-page target that preserves the owning session and policy', () => {
    expect(createChatPageSessionTarget(
      { kind: 'scheduled', taskId: 'task-1' },
      'session-1',
      'Daily brief',
    )).toMatchObject({
      surface: 'page',
      scopeId: '__scheduled__-task-1',
      sessionId: 'session-1',
      contextSnapshot: { label: 'Daily brief' },
      executionPolicy: 'scheduled',
    });
  });

  it('uses semantic renderer keys without leaking storage sentinels', () => {
    expect(chatScopeKey({ kind: 'global' })).toBe('global');
    expect(chatScopeKey({ kind: 'scheduled', taskId: 'task-1' })).toBe('scheduled:task-1');
    expect(chatScopeKey({ kind: 'workspace', workspaceId: 'workspace-1' }))
      .toBe('workspace:workspace-1');
  });
});
