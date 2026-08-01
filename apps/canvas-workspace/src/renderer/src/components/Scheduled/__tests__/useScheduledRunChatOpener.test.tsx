// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledRunFinished } from '../../../../../shared/scheduled';
import { I18nProvider } from '../../../i18n';
import { AppShellProvider } from '../../AppShellProvider';
import { RightDockProvider, useRightDock, useRightDockState } from '../../RightDock';
import type { DockState } from '../../RightDock/dock-store';
import { useScheduledRunChatOpener } from '../useScheduledRunChatOpener';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let dockState: DockState | undefined;
let openScheduledChat: ((taskId: string) => void) | undefined;
let collapseDock: (() => void) | undefined;

const Harness = ({ activeView }: { activeView: string }) => {
  const dock = useRightDock();
  dockState = useRightDockState();
  openScheduledChat = dock.openScheduledChat;
  collapseDock = dock.collapse;
  useScheduledRunChatOpener({ activeView, chatRoute: '/chat' });
  return null;
};

const mount = async (activeView = 'scheduled') => {
  // This hook subscribes TWICE to `scheduled:run-finished` — once to refresh
  // an open conversation, once (via `useScheduledRunToasts`) to announce it.
  // `preload/bridge/ipc.ts`'s `subscribe` registers an independent
  // `ipcRenderer.on` per call, so both really run; a mock that kept only the
  // last callback would silently test half the hook.
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
          <RightDockProvider>
            <Harness activeView={activeView} />
          </RightDockProvider>
        </AppShellProvider>
      </I18nProvider>,
    );
  });
  expect(listeners.length).toBeGreaterThan(1);
  return (run: ScheduledRunFinished) => act(() => {
    for (const listener of [...listeners]) listener(run);
  });
};

const toasts = () => [...document.querySelectorAll('.shell-toast')];

const finished = (over: Partial<ScheduledRunFinished> = {}): ScheduledRunFinished => ({
  taskId: 'daily-brief',
  title: 'Morning brief',
  ok: true,
  trigger: 'schedule',
  ...over,
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  dockState = undefined;
  openScheduledChat = undefined;
  collapseDock = undefined;
  vi.restoreAllMocks();
});

describe('useScheduledRunChatOpener', () => {
  /**
   * `ScheduledChatPanel`'s running banner promises "the result will appear
   * here". Nothing refetched the thread except the manual `Run now` path, so
   * an unattended run ended with the banner vanishing and no new message.
   */
  it('reloads an open task conversation when its background run finishes', async () => {
    const emit = await mount();

    await act(async () => { openScheduledChat?.('daily-brief'); });
    const openedAt = dockState?.scheduledChatRevision ?? 0;

    await emit(finished());
    expect(dockState?.scheduledChatRevision).toBe(openedAt + 1);
  });

  it('leaves the dock alone for a task it is not showing', async () => {
    const emit = await mount();

    await act(async () => { openScheduledChat?.('daily-brief'); });
    const openedAt = dockState?.scheduledChatRevision ?? 0;

    await emit(finished({ taskId: 'weekly-report', title: 'Weekly report' }));
    expect(dockState?.scheduledChatRevision).toBe(openedAt);
  });

  /**
   * `Run now` opens this exact panel and holds the user there for the whole
   * run, so its completion toast landed on top of the answer with an action
   * pointing at it. The thread still has to refresh.
   */
  it('refreshes but stays silent for a manual run the user is watching', async () => {
    const emit = await mount();

    await act(async () => { openScheduledChat?.('daily-brief'); });
    const openedAt = dockState?.scheduledChatRevision ?? 0;

    await emit(finished({ trigger: 'manual' }));
    expect(dockState?.scheduledChatRevision).toBe(openedAt + 1);
    expect(toasts()).toHaveLength(0);

    // An unattended run on the same visible panel still announces itself.
    await emit(finished({ trigger: 'schedule' }));
    expect(toasts()).toHaveLength(1);
  });

  /** Pointed at the task is not the same as showing it. */
  it('announces a manual run once the user has collapsed the dock', async () => {
    const emit = await mount();

    await act(async () => { openScheduledChat?.('daily-brief'); });
    await act(async () => { collapseDock?.(); });
    expect(dockState?.scheduledChatTaskId).toBe('daily-brief');
    expect(dockState?.expanded).toBe(false);

    await emit(finished({ trigger: 'manual' }));
    expect(toasts()).toHaveLength(1);
  });
});
