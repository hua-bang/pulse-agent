import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcpTimeoutError } from './client.js';
import {
  __testCreatePromptProgressTimeouts,
  __testResolveTimeoutConfig,
} from './runner.js';

const ENV_KEYS = [
  'ACP_PROMPT_TIMEOUT_MS',
  'ACP_PROMPT_IDLE_TIMEOUT_MS',
  'ACP_PROMPT_HARD_TIMEOUT_MS',
];
const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  vi.useRealTimers();
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('ACP runner timeout config', () => {
  it('treats legacy ACP_PROMPT_TIMEOUT_MS as the idle timeout fallback', () => {
    process.env.ACP_PROMPT_TIMEOUT_MS = '1234';
    delete process.env.ACP_PROMPT_IDLE_TIMEOUT_MS;
    delete process.env.ACP_PROMPT_HARD_TIMEOUT_MS;

    expect(__testResolveTimeoutConfig()).toMatchObject({
      promptIdleMs: 1234,
      promptHardMs: 30 * 60_000,
    });
  });

  it('lets ACP_PROMPT_IDLE_TIMEOUT_MS override the legacy prompt timeout', () => {
    process.env.ACP_PROMPT_TIMEOUT_MS = '1234';
    process.env.ACP_PROMPT_IDLE_TIMEOUT_MS = '5678';
    process.env.ACP_PROMPT_HARD_TIMEOUT_MS = '0';

    expect(__testResolveTimeoutConfig()).toMatchObject({
      promptIdleMs: 5678,
      promptHardMs: 0,
    });
  });
});

describe('ACP prompt progress timeouts', () => {
  it('resets the idle timeout when progress is marked', async () => {
    vi.useFakeTimers();
    const timeouts = __testCreatePromptProgressTimeouts({
      idleMs: 100,
      hardMs: 0,
      method: 'session/prompt',
    });

    const observed = vi.fn();
    timeouts.timeoutPromise.catch(observed);

    await vi.advanceTimersByTimeAsync(90);
    timeouts.markProgress();
    await vi.advanceTimersByTimeAsync(90);
    expect(observed).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10);
    expect(observed).toHaveBeenCalledTimes(1);
    expect(observed.mock.calls[0]?.[0]).toBeInstanceOf(AcpTimeoutError);
    expect(String(observed.mock.calls[0]?.[0].message)).toContain('idle timed out after 100ms');

    timeouts.dispose();
  });

  it('fires the hard timeout even when progress keeps arriving', async () => {
    vi.useFakeTimers();
    const timeouts = __testCreatePromptProgressTimeouts({
      idleMs: 100,
      hardMs: 250,
      method: 'session/prompt',
    });

    const observed = vi.fn();
    timeouts.timeoutPromise.catch(observed);

    await vi.advanceTimersByTimeAsync(90);
    timeouts.markProgress();
    await vi.advanceTimersByTimeAsync(90);
    timeouts.markProgress();
    await vi.advanceTimersByTimeAsync(69);
    expect(observed).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(observed).toHaveBeenCalledTimes(1);
    expect(observed.mock.calls[0]?.[0]).toBeInstanceOf(AcpTimeoutError);
    expect(String(observed.mock.calls[0]?.[0].message)).toContain('hard timed out after 250ms');

    timeouts.dispose();
  });
});
