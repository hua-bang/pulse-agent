// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useConsumePendingLinks } from './useConsumePendingLinks';

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

function setConsumePending(consumePending: () => Promise<{ urls: string[] }>): void {
  (globalThis as { canvasWorkspace?: unknown }).canvasWorkspace = {
    defaultBrowser: { consumePending },
  };
}

function mountProbe(open: (url: string) => void, initialReady: boolean): { setReady: (ready: boolean) => void } {
  const Probe = ({ ready }: { ready: boolean }) => {
    useConsumePendingLinks(open, ready);
    return null;
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(<Probe ready={initialReady} />);
  });
  return {
    setReady: (ready: boolean) => {
      act(() => {
        root?.render(<Probe ready={ready} />);
      });
    },
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('useConsumePendingLinks', () => {
  it('does not drain pending urls while ready is false', async () => {
    const consumePending = vi.fn().mockResolvedValue({ urls: ['https://example.com'] });
    setConsumePending(consumePending);
    const open = vi.fn();

    mountProbe(open, false);
    await flush();

    expect(consumePending).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('drains queued urls in order once ready flips true', async () => {
    const consumePending = vi.fn().mockResolvedValue({ urls: ['https://a.example', 'https://b.example'] });
    setConsumePending(consumePending);
    const open = vi.fn();

    const probe = mountProbe(open, false);
    await flush();
    expect(open).not.toHaveBeenCalled();

    probe.setReady(true);
    await flush();

    expect(consumePending).toHaveBeenCalledTimes(1);
    expect(open.mock.calls.map((call) => call[0])).toEqual(['https://a.example', 'https://b.example']);
  });

  it('does not re-drain on a later render once already ready', async () => {
    const consumePending = vi.fn().mockResolvedValue({ urls: ['https://a.example'] });
    setConsumePending(consumePending);
    const open = vi.fn();

    const probe = mountProbe(open, true);
    await flush();
    expect(consumePending).toHaveBeenCalledTimes(1);

    // A re-render that keeps ready=true (e.g. a sibling state change) must
    // not trigger a second drain of an already-empty queue.
    probe.setReady(true);
    await flush();
    expect(consumePending).toHaveBeenCalledTimes(1);
  });
});
