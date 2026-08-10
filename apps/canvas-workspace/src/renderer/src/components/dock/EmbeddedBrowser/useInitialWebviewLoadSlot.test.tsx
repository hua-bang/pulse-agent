// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const scheduler = vi.hoisted(() => {
  const scheduled: Array<{
    id: string;
    grant: () => void;
    handle: { cancel: ReturnType<typeof vi.fn>; updatePriority: ReturnType<typeof vi.fn> };
  }> = [];
  return {
    release: vi.fn(),
    schedule: vi.fn((id: string, _priority: number, grant: () => void) => {
      const handle = { cancel: vi.fn(), updatePriority: vi.fn() };
      scheduled.push({ id, grant, handle });
      return handle;
    }),
    scheduled,
  };
});

vi.mock('./initial-load-scheduler', () => ({
  initialWebviewLoadScheduler: scheduler,
}));

import { useInitialWebviewLoadSlot } from './useInitialWebviewLoadSlot';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let mount: HTMLDivElement | null = null;
let latest: ReturnType<typeof useInitialWebviewLoadSlot> | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  scheduler.scheduled.splice(0);
  latest = null;
  mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);
});

afterEach(() => {
  act(() => root?.unmount());
  mount?.remove();
  root = null;
  mount = null;
});

describe('useInitialWebviewLoadSlot', () => {
  it('keeps a granted first-navigation lease accounted under its original id', async () => {
    const Harness = ({ id }: { id: string }) => {
      latest = useInitialWebviewLoadSlot({ eligible: true, id, priority: 0 });
      return null;
    };

    await act(async () => root?.render(<Harness id="dock:workspace-a:tab" />));
    expect(scheduler.scheduled).toHaveLength(1);
    const firstLease = scheduler.scheduled[0];

    await act(async () => firstLease.grant());
    expect(latest?.granted).toBe(true);

    await act(async () => root?.render(<Harness id="dock:workspace-b:tab" />));

    expect(firstLease.handle.cancel).not.toHaveBeenCalled();
    expect(scheduler.schedule).toHaveBeenCalledTimes(1);

    act(() => latest?.release('complete'));
    expect(scheduler.release).toHaveBeenCalledWith('dock:workspace-a:tab', 'complete');

    act(() => root?.unmount());
    root = null;
    expect(firstLease.handle.cancel).toHaveBeenCalledOnce();
  });
});
