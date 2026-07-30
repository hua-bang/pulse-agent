// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledRunFinished } from '../../../../../shared/scheduled';
import { I18nProvider } from '../../../i18n';
import { AppShellProvider } from '../../AppShellProvider';

const dock = vi.hoisted(() => ({
  openScheduledChat: vi.fn(),
  refreshScheduledChat: vi.fn(),
}));

vi.mock('../../RightDock', () => ({ useRightDock: () => dock }));
vi.mock('wouter', () => ({ useLocation: () => ['/', vi.fn()] }));

import { useScheduledRunChatOpener } from '../useScheduledRunChatOpener';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const Harness = () => {
  useScheduledRunChatOpener({ activeView: 'canvas', chatRoute: '/chat' });
  return null;
};

const mount = async () => {
  // The hook subscribes TWICE to this push (auto-refresh + toast), exactly as
  // the preload `subscribe` helper supports, so the fake must fan out rather
  // than keep only the last listener.
  const listeners: Array<(run: ScheduledRunFinished) => void> = [];
  Object.defineProperty(window, 'canvasWorkspace', {
    configurable: true,
    value: {
      scheduled: {
        onRunFinished: (callback: (run: ScheduledRunFinished) => void) => {
          listeners.push(callback);
          return () => listeners.splice(listeners.indexOf(callback), 1);
        },
      },
    },
  });

  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <I18nProvider>
        <AppShellProvider>
          <Harness />
        </AppShellProvider>
      </I18nProvider>,
    );
  });
  return (run: ScheduledRunFinished) => act(() => {
    for (const listener of [...listeners]) listener(run);
  });
};

beforeEach(() => {
  dock.openScheduledChat.mockClear();
  dock.refreshScheduledChat.mockClear();
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

describe('useScheduledRunChatOpener', () => {
  /**
   * A timer-driven run finishing while its conversation was open used to leave
   * the panel on a stale "working on this task…" placeholder: only Run now
   * bumped the revision, so the reply appeared only after a toast click.
   */
  it('refreshes the task conversation as soon as a run finishes, without opening it', async () => {
    const emit = await mount();

    emit({ taskId: 'daily-brief', title: 'Morning brief', ok: true });

    expect(dock.refreshScheduledChat).toHaveBeenCalledWith('daily-brief');
    // Refresh is a no-op unless the dock is already showing that task, so it
    // must NOT pull the conversation open on its own.
    expect(dock.openScheduledChat).not.toHaveBeenCalled();
  });

  it('refreshes a failed run too — its error belongs in the conversation as well', async () => {
    const emit = await mount();

    emit({ taskId: 'daily-brief', title: 'Morning brief', ok: false, error: 'model unavailable' });

    expect(dock.refreshScheduledChat).toHaveBeenCalledWith('daily-brief');
  });

  it('opens the conversation in the dock when the completion toast is acted on', async () => {
    const emit = await mount();

    emit({ taskId: 'daily-brief', title: 'Morning brief', ok: true });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.shell-toast__action')?.click();
    });

    expect(dock.openScheduledChat).toHaveBeenCalledWith('daily-brief');
  });
});
