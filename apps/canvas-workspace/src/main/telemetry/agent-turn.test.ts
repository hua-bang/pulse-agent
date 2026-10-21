import { describe, expect, it, vi } from 'vitest';
import { classifyTurnError, startAgentTurnTelemetry } from './agent-turn';

describe('startAgentTurnTelemetry', () => {
  it('pairs one start with one finish and counts tools and created nodes', () => {
    const track = vi.fn();
    let time = 1_000;
    const turn = startAgentTurnTelemetry({
      scope: 'workspace',
      trigger: 'user',
      requestContext: { executionMode: 'ask', selectedNodes: [{} as never, {} as never] },
      attachmentCount: 1,
      mentionedWorkspaceCount: 1,
    }, track, () => time);
    turn.toolCall('canvas_read_node');
    turn.toolCall('canvas_create_node');
    time = 4_500;
    turn.finish({ ok: true });
    turn.finish({ ok: false, error: 'late' });

    expect(track.mock.calls).toEqual([
      ['agent_turn_started', {
        scope: 'workspace',
        trigger: 'user',
        execution_mode: 'ask',
        has_attachments: true,
        context_count: 3,
      }],
      ['agent_turn_finished', {
        scope: 'workspace',
        trigger: 'user',
        outcome: 'completed',
        duration_ms: 3_500,
        tool_calls: 2,
        nodes_created: 1,
      }],
    ]);
  });

  it('reports a stop as stopped and a failure with its error class only', () => {
    const track = vi.fn();
    startAgentTurnTelemetry({ scope: 'global', trigger: 'schedule' }, track).finish({ ok: true, stopped: true });
    startAgentTurnTelemetry({ scope: 'global', trigger: 'user' }, track)
      .finish({ ok: false, error: '401 Unauthorized: invalid key sk-secret' });
    const finished = track.mock.calls.filter(([event]) => event === 'agent_turn_finished').map(([, props]) => props);
    expect(finished[0]).toMatchObject({ outcome: 'stopped' });
    expect(finished[0]).not.toHaveProperty('error_kind');
    expect(finished[1]).toMatchObject({ outcome: 'failed', error_kind: 'auth' });
    expect(JSON.stringify(finished)).not.toContain('sk-secret');
  });
});

describe('classifyTurnError', () => {
  it('maps codes and common provider errors to coarse classes', () => {
    expect(classifyTurnError({ ok: false, code: 'CHAT_SCOPE_BUSY' })).toBe('chat_scope_busy');
    expect(classifyTurnError({ ok: false, error: 'Rate limit exceeded (429)' })).toBe('rate_limit');
    expect(classifyTurnError({ ok: false, error: 'fetch failed: ECONNRESET' })).toBe('network');
    expect(classifyTurnError({ ok: false, error: 'prompt exceeds context window' })).toBe('context_length');
    expect(classifyTurnError({ ok: false, error: 'something odd' })).toBe('unknown');
  });
});
