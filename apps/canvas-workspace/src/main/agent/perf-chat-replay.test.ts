import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PERF_CHAT_REPLAY_MESSAGE,
  isPerfChatReplayRequest,
  replayPerfChatStream,
} from './perf-chat-replay';

describe('perf chat replay', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is available only for the exact opt-in prompt and perf environment', () => {
    expect(isPerfChatReplayRequest(PERF_CHAT_REPLAY_MESSAGE, true)).toBe(true);
    expect(isPerfChatReplayRequest(PERF_CHAT_REPLAY_MESSAGE, false)).toBe(false);
    expect(isPerfChatReplayRequest('normal user prompt', true)).toBe(false);
  });

  it('replays a code-dense response through text-delta and completion channels', async () => {
    vi.useFakeTimers();
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const sender = {
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
    };

    const replay = replayPerfChatStream(sender, 'perf-session', { intervalMs: 4 });
    await vi.runAllTimersAsync();
    await replay;

    const deltas = sent.filter((entry) => entry.channel === 'canvas-agent:text-delta:perf-session');
    const completion = sent.find((entry) => entry.channel === 'canvas-agent:chat-complete:perf-session');
    expect(deltas.length).toBeGreaterThan(200);
    expect(deltas.map((entry) => entry.payload).join('')).toContain('```mermaid');
    expect(completion?.payload).toMatchObject({ ok: true });
  });
});
