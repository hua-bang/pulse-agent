// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PendingClarification } from '../types';
import type { RelayProgress } from './relayTurnHandlers';
import { useChatRunControls } from './useChatRunControls';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let latest: {
  abort: () => Promise<boolean>;
  stopRelay: () => Promise<boolean>;
  relay: RelayProgress | null;
  pendingClarify: PendingClarification | null;
  clarifyInput: string;
} | null = null;

const Probe = () => {
  const [relay, setRelay] = useState<RelayProgress | null>({
    speaking: 0,
    total: 2,
    queue: [],
    stopping: false,
  });
  const [pendingClarify, setPendingClarify] = useState<PendingClarification | null>({
    id: 'clarify-1',
    question: 'Allow this?',
  });
  const [clarifyInput, setClarifyInput] = useState('Yes');
  const controls = useChatRunControls({
    activeSessionId: 'run-1',
    setRelay,
    setPendingClarify,
    setClarifyInput,
  });
  latest = { ...controls, relay, pendingClarify, clarifyInput };
  return null;
};

async function renderProbe(): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<Probe />);
  });
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  latest = null;
  vi.restoreAllMocks();
});

describe('useChatRunControls', () => {
  it('restores the relay action when main rejects the stop request', async () => {
    const agent = {
      stopRelay: vi.fn(async () => ({ ok: false, error: 'No relay in flight' })),
      abort: vi.fn(async () => ({ ok: true })),
    };
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { agent },
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await renderProbe();

    await act(async () => {
      await latest?.stopRelay();
    });

    expect(agent.stopRelay).toHaveBeenCalledWith('run-1');
    expect(latest?.relay?.stopping).toBe(false);
  });

  it('keeps a clarification actionable when main rejects the abort request', async () => {
    const agent = {
      stopRelay: vi.fn(async () => ({ ok: true })),
      abort: vi.fn(async () => ({ ok: false, error: 'No active run for sessionId' })),
    };
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { agent },
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await renderProbe();

    await act(async () => {
      await latest?.abort();
    });

    expect(agent.abort).toHaveBeenCalledWith('run-1');
    expect(latest?.pendingClarify).toMatchObject({ id: 'clarify-1' });
    expect(latest?.clarifyInput).toBe('Yes');
  });

  it('clears clarification state after main acknowledges the abort request', async () => {
    const agent = {
      stopRelay: vi.fn(async () => ({ ok: true })),
      abort: vi.fn(async () => ({ ok: true })),
    };
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { agent },
    });
    await renderProbe();

    await act(async () => {
      await latest?.abort();
    });

    expect(latest?.pendingClarify).toBeNull();
    expect(latest?.clarifyInput).toBe('');
  });
});
