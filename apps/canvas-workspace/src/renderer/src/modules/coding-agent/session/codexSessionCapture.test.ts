import { describe, expect, it, vi } from 'vitest';
import type { CodexSessionsApi } from '../../../types/codex-sessions';
import { startCodexSessionCapture } from './codexSessionCapture';

describe('Codex session capture', () => {
  it('prefers the node marker and publishes the exact matching session', async () => {
    vi.useFakeTimers();
    const onCaptured = vi.fn();
    const api: CodexSessionsApi = {
      list: vi.fn(),
      findByMarker: vi.fn().mockResolvedValue({
        ok: true,
        session: { id: 'codex-1', cwd: '/repo', updatedAtMs: 10 },
      }),
    };
    startCodexSessionCapture({
      api,
      baselineIds: new Set(),
      launchStartedAt: 2_000,
      marker: 'marker-1',
      cwd: '/repo',
      onCaptured,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(api.findByMarker).toHaveBeenCalledWith({
      marker: 'marker-1',
      updatedAfterMs: 0,
      cwd: '/repo',
    });
    expect(onCaptured).toHaveBeenCalledWith('codex-1');
    expect(api.list).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does not publish a session after cancellation', async () => {
    vi.useFakeTimers();
    const onCaptured = vi.fn();
    const api: CodexSessionsApi = {
      list: vi.fn(),
      findByMarker: vi.fn().mockResolvedValue({ ok: true, session: { id: 'late' } }),
    };
    const cancel = startCodexSessionCapture({
      api,
      baselineIds: null,
      launchStartedAt: 2_000,
      marker: 'marker-1',
      onCaptured,
    });
    cancel();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(onCaptured).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
