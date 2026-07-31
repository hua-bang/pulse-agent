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
});
