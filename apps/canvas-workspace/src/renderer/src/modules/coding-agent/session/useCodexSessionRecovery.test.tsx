// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { useCodexSessionRecovery } from '..';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Codex session recovery', () => {
  it('recovers a persisted marker into the node-owned session id', async () => {
    const onRecovered = vi.fn();
    const api = { findByMarker: vi.fn().mockResolvedValue({ ok: true, session: { id: 'codex-1' } }) };
    const Harness = () => {
      useCodexSessionRecovery({
        data: { agentType: 'codex', sessionId: 'pty-1', codexSessionMarker: 'marker-1', cwd: '/repo' },
        disabled: false,
        api,
        onRecovered,
      });
      return null;
    };
    const root = createRoot(document.createElement('div'));
    await act(async () => { root.render(<Harness />); });
    await act(async () => { await Promise.resolve(); });
    expect(api.findByMarker).toHaveBeenCalledWith({ marker: 'marker-1', cwd: '/repo' });
    expect(onRecovered).toHaveBeenCalledWith('codex-1');
    await act(async () => { root.unmount(); });
  });
});
