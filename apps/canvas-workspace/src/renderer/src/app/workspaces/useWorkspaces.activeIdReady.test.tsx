// @vitest-environment happy-dom
// Regression coverage for the deep-link cold-start race: a default-browser
// link activation must not land its new tab in the mount-time 'default'
// placeholder workspace, only to have the real persisted workspace restore
// wipe it out once the manifest finishes loading. useConsumePendingLinks
// gates on activeIdReady instead of the raw activeId for exactly this
// reason — these tests pin the invariant it relies on: activeId is already
// final by the render where activeIdReady first turns true.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaces } from './useWorkspaces';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  delete (globalThis as { canvasWorkspace?: unknown }).canvasWorkspace;
});

type LogEntry = { activeId: string; activeIdReady: boolean };

function renderWorkspacesProbe(): { log: LogEntry[] } {
  const log: LogEntry[] = [];
  const Probe = () => {
    const { activeId, activeIdReady } = useWorkspaces();
    log.push({ activeId, activeIdReady });
    return null;
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(<Probe />);
  });
  return { log };
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('useWorkspaces activeIdReady', () => {
  it('never reports ready while activeId is still the mount-time placeholder', async () => {
    const load = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        workspaces: [{ id: 'default', name: 'Workspace' }, { id: 'ws-a', name: 'A' }],
        activeId: 'ws-a',
      },
    });
    (globalThis as { canvasWorkspace?: unknown }).canvasWorkspace = { store: { load, save: vi.fn() } };

    const { log } = renderWorkspacesProbe();
    expect(log[0]).toEqual({ activeId: 'default', activeIdReady: false });

    await flush();

    const firstReady = log.find((entry) => entry.activeIdReady);
    expect(firstReady).toEqual({ activeId: 'ws-a', activeIdReady: true });
  });

  it('still settles activeIdReady when the manifest load rejects', async () => {
    const load = vi.fn().mockRejectedValue(new Error('disk error'));
    (globalThis as { canvasWorkspace?: unknown }).canvasWorkspace = { store: { load, save: vi.fn() } };

    const { log } = renderWorkspacesProbe();
    await flush();

    expect(log.at(-1)).toEqual({ activeId: 'default', activeIdReady: true });
  });

  it('settles activeIdReady immediately when the store bridge is unavailable', async () => {
    delete (globalThis as { canvasWorkspace?: unknown }).canvasWorkspace;

    const { log } = renderWorkspacesProbe();
    await flush();

    expect(log.at(-1)).toEqual({ activeId: 'default', activeIdReady: true });
  });
});
