import { describe, expect, it } from 'vitest';

import { ActiveChatRegistry } from './active-chat-registry';

describe('ActiveChatRegistry', () => {
  it('latches an abort before the run starts consuming its signal', () => {
    const registry = new ActiveChatRegistry();
    const signal = registry.register('run-1', { kind: 'global' });

    expect(registry.abort('run-1')).toBe(true);
    expect(signal?.aborted).toBe(true);
    expect(registry.has('run-1')).toBe(true);
  });

  it('allows only one run per scope while keeping other scopes independent', () => {
    const registry = new ActiveChatRegistry();
    const scope = { kind: 'workspace', workspaceId: 'workspace-1' } as const;
    const first = registry.register('run-1', scope);
    const rejected = registry.register('run-2', scope);
    const second = registry.register('run-3', {
      kind: 'workspace',
      workspaceId: 'workspace-2',
    });

    registry.abort('run-1');

    expect(first?.aborted).toBe(true);
    expect(rejected).toBeNull();
    expect(second?.aborted).toBe(false);
    expect(registry.hasScope(scope)).toBe(true);
    expect(registry.sessionIdForScope(scope)).toBe('run-1');
  });

  it('allows two runs in one scope when they anchor to different conversations', () => {
    const registry = new ActiveChatRegistry();
    const scope = { kind: 'workspace', workspaceId: 'workspace-1' } as const;
    const first = registry.register('run-a', scope, 'conversation-a');
    const second = registry.register('run-b', scope, 'conversation-b');

    expect(first?.aborted).toBe(false);
    expect(second?.aborted).toBe(false);
    expect(registry.has('run-a')).toBe(true);
    expect(registry.has('run-b')).toBe(true);
  });

  it('rejects a second run for the same conversation session in one scope', () => {
    const registry = new ActiveChatRegistry();
    const scope = { kind: 'workspace', workspaceId: 'workspace-1' } as const;
    const first = registry.register('run-a', scope, 'conversation-a');
    const rejected = registry.register('run-a2', scope, 'conversation-a');

    expect(first?.aborted).toBe(false);
    expect(rejected).toBeNull();
    expect(registry.hasConversationSession(scope, 'conversation-a')).toBe(true);
    // A different conversation in the same scope is still available.
    expect(registry.hasConversationSession(scope, 'conversation-b')).toBe(false);
  });

  it('treats a conversation-less run as a per-scope exclusive (legacy behavior)', () => {
    const registry = new ActiveChatRegistry();
    const scope = { kind: 'workspace', workspaceId: 'workspace-1' } as const;
    expect(registry.register('run-a', scope)).not.toBeNull();
    expect(registry.register('run-b', scope)).toBeNull();
    // Explicit conversation anchor still collides with the legacy exclusive run.
    expect(registry.register('run-c', scope, 'conversation-a')).toBeNull();
  });

  it('reports the conversation session id of a scope run', () => {
    const registry = new ActiveChatRegistry();
    const scope = { kind: 'workspace', workspaceId: 'workspace-1' } as const;
    registry.reserve('run-a', scope, 'conversation-a');

    expect(registry.conversationSessionIdForScope(scope)).toBe('conversation-a');
    registry.startReserved('run-a');
    expect(registry.conversationSessionIdForScope(scope)).toBe('conversation-a');
    registry.settle('run-a');
    expect(registry.conversationSessionIdForScope(scope)).toBeUndefined();
  });

  it('reserves a scope during prepare and upgrades the same run at start', () => {
    const registry = new ActiveChatRegistry();
    const scope = { kind: 'workspace', workspaceId: 'workspace-1' } as const;

    expect(registry.reserve('prepared', scope)).toBe(true);
    expect(registry.hasScope(scope)).toBe(true);
    expect(registry.has('prepared')).toBe(false);
    expect(registry.reserve('blocked', scope)).toBe(false);

    const signal = registry.startReserved('prepared');
    expect(signal?.aborted).toBe(false);
    expect(registry.has('prepared')).toBe(true);
    expect(registry.sessionIdForScope(scope)).toBe('prepared');
  });

  it('latches stop between prepare and start', () => {
    const registry = new ActiveChatRegistry();
    expect(registry.reserve('prepared-stop', { kind: 'global' })).toBe(true);

    expect(registry.abort('prepared-stop')).toBe(true);
    const signal = registry.startReserved('prepared-stop');

    expect(signal?.aborted).toBe(true);
    expect(registry.has('prepared-stop')).toBe(true);
  });

  it('releases an abandoned prepare without disturbing another scope', () => {
    const registry = new ActiveChatRegistry();
    const scope = { kind: 'global' } as const;
    expect(registry.reserve('abandoned', scope)).toBe(true);

    expect(registry.releaseReservation('abandoned')).toBe(true);
    expect(registry.hasScope(scope)).toBe(false);
    expect(registry.register('replacement', scope)).not.toBeNull();
  });

  it('removes settled runs and aborts every active run on clear', () => {
    const registry = new ActiveChatRegistry();
    const settled = registry.register('settled', { kind: 'global' });
    const active = registry.register('active', { kind: 'scheduled', taskId: 'daily' });

    registry.settle('settled');
    expect(registry.has('settled')).toBe(false);
    expect(registry.abort('settled')).toBe(false);
    expect(settled?.aborted).toBe(false);

    registry.clear();
    expect(active?.aborted).toBe(true);
    expect(registry.has('active')).toBe(false);
  });

  it('replays ordered stream events that were emitted while no renderer listener existed', () => {
    const registry = new ActiveChatRegistry();
    registry.register('run-replay', { kind: 'global' }, 'conversation-a');

    registry.recordStreamEvent('run-replay', 'tool-call', { name: 'canvas_read_node' });
    registry.recordStreamEvent('run-replay', 'text-delta', 'Recovered answer');

    const first = registry.readStreamEvents('run-replay', 0);
    expect(first).toMatchObject({
      active: true,
      cursor: 2,
      events: [
        { sequence: 1, channel: 'tool-call', data: { name: 'canvas_read_node' } },
        { sequence: 2, channel: 'text-delta', data: 'Recovered answer' },
      ],
    });
    expect(registry.readStreamEvents('run-replay', 1)?.events).toEqual([
      { sequence: 2, channel: 'text-delta', data: 'Recovered answer' },
    ]);
  });

  it('keeps the final replay events available after the active run settles', () => {
    const registry = new ActiveChatRegistry();
    registry.register('run-complete', { kind: 'global' }, 'conversation-a');
    registry.recordStreamEvent('run-complete', 'text-delta', 'Final answer');
    registry.recordStreamEvent('run-complete', 'chat-complete', { ok: true });

    registry.settle('run-complete');

    expect(registry.has('run-complete')).toBe(false);
    expect(registry.readStreamEvents('run-complete', 0)).toMatchObject({
      active: false,
      cursor: 2,
      events: [
        { sequence: 1, channel: 'text-delta', data: 'Final answer' },
        { sequence: 2, channel: 'chat-complete', data: { ok: true } },
      ],
    });
  });
});
