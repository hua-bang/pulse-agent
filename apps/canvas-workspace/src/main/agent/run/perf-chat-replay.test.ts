import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PERF_CHAT_REPLAY_MESSAGE,
  isPerfChatReplayRequest,
  replayPerfChatStream,
} from './perf-chat-replay';

const savedEnv = { ...process.env };

describe('perf chat replay', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
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

    const onComplete = vi.fn();
    const replay = replayPerfChatStream(sender, 'perf-session', { intervalMs: 4, onComplete });
    await vi.runAllTimersAsync();
    await replay;

    const deltas = sent.filter((entry) => entry.channel === 'canvas-agent:text-delta:perf-session');
    const completion = sent.find((entry) => entry.channel === 'canvas-agent:chat-complete:perf-session');
    expect(deltas.length).toBeGreaterThan(200);
    expect(deltas.map((entry) => entry.payload).join('')).toContain('```mermaid');
    expect(completion?.payload).toMatchObject({ ok: true });
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete.mock.calls[0]?.[0]).toContain('```typescript');
  });

  it('honors env overrides to slow the stream down for mid-stream UI demos', async () => {
    vi.useFakeTimers();
    vi.stubEnv('PULSE_CANVAS_PERF_INTERVAL_MS', '500');
    vi.stubEnv('PULSE_CANVAS_PERF_STARTUP_DELAY_MS', '1000');
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const sender = {
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
    };

    const replay = replayPerfChatStream(sender, 'slow-session', { intervalMs: 4 });
    // The env override must win over the option default (4ms → 500ms).
    await vi.advanceTimersByTimeAsync(999);
    const beforeStartup = sent.filter((e) => e.channel === 'canvas-agent:text-delta:slow-session');
    expect(beforeStartup.length).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    // 500ms of stream time must NOT emit the ~125 chunks the 4ms default
    // would — the env override demonstrably slows the stream down.
    await vi.advanceTimersByTimeAsync(500);
    const afterHalfSecond = sent.filter((e) => e.channel === 'canvas-agent:text-delta:slow-session');
    expect(afterHalfSecond.length).toBeLessThan(10);
    // Finish the whole stream (each chunk advances 500ms).
    await vi.runAllTimersAsync();
    await replay;
    const deltas = sent.filter((e) => e.channel === 'canvas-agent:text-delta:slow-session');
    expect(deltas.length).toBeGreaterThan(200);
  });
});
