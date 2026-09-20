import { describe, expect, it, vi } from 'vitest';
import { prepareRunSession } from './run-session-context';
import type { CanvasAgentSession } from './types';

describe('follow-up model context from the anchored session', () => {
  it('restores saved tool outcomes for the selected conversation and retains later user text', async () => {
    const session: CanvasAgentSession = { sessionId: 'selected', workspaceId: 'ws', startedAt: '2026-09-20T00:00:00.000Z', messages: [
      { role: 'assistant', content: 'Stopped.', timestamp: 1, toolCalls: [{
        id: 1, name: 'page_run', status: 'succeeded', result: '{"status":"needs_input","reason":"Need Email"}',
      }] },
      { role: 'user', content: 'Why did it stop?', timestamp: 2 },
    ] };
    const appendToSession = vi.fn();
    const result = await prepareRunSession({
      getCurrentSession: () => ({ ...session, sessionId: 'unrelated', messages: [] }),
      readSession: async id => id === 'selected' ? session : null,
      appendToSession,
    }, 'selected');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Session missing');
    expect(JSON.stringify(result.runMessages)).toContain('Need Email');
    expect(result.runMessages[1].content).toBe('Why did it stop?');
    expect(appendToSession).not.toHaveBeenCalled();
  });
});
