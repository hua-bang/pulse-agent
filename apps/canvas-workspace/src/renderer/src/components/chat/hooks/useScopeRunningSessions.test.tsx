// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScopeRunningSessions } from './useScopeRunningSessions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let latest: Set<string> = new Set();

const Probe = ({ scope, scopeKey }: { scope: unknown; scopeKey: string }) => {
  latest = useScopeRunningSessions(scope as never, scopeKey, 50);
  return null;
};

beforeEach(() => {
  (window as unknown as { canvasWorkspace: unknown }).canvasWorkspace = {
    agent: {
      getScopeRunningSessions: vi.fn(async () => ({ ok: true, conversationSessionIds: [] })),
    },
  };
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  vi.restoreAllMocks();
});

describe('useScopeRunningSessions', () => {
  it('reports the conversation session ids with an active run', async () => {
    const spy = vi
      .spyOn(window.canvasWorkspace.agent, 'getScopeRunningSessions')
      .mockResolvedValue({ ok: true, conversationSessionIds: ['conv-a', 'conv-b'] });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<Probe scope={{ kind: 'workspace', workspaceId: 'ws' }} scopeKey="ws" />);
      await new Promise(resolve => setTimeout(resolve, 60));
    });

    expect(spy).toHaveBeenCalled();
    expect(latest).toEqual(new Set(['conv-a', 'conv-b']));
    act(() => root?.unmount());
  });

  it('empties the set when a run completes', async () => {
    const spy = vi
      .spyOn(window.canvasWorkspace.agent, 'getScopeRunningSessions')
      .mockResolvedValue({ ok: true, conversationSessionIds: ['conv-a'] });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<Probe scope={{ kind: 'workspace', workspaceId: 'ws' }} scopeKey="ws" />);
      await new Promise(resolve => setTimeout(resolve, 60));
    });
    expect(latest).toEqual(new Set(['conv-a']));

    spy.mockResolvedValue({ ok: true, conversationSessionIds: [] });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 60));
    });
    expect(latest.size).toBe(0);
    act(() => root?.unmount());
  });
});
