// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledRunFinished } from '../../../../../../shared/scheduled';
import { I18nProvider } from '../../../../i18n';
import { AppShellProvider } from '../../../../components/shell/AppShellProvider';
import { useScheduledRunToasts } from '../useScheduledRunToasts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const Harness = ({ onOpenRun }: { onOpenRun: (run: ScheduledRunFinished) => void }) => {
  useScheduledRunToasts(onOpenRun);
  return null;
};

/** Mounts the hook and hands back the main-process push it subscribed with. */
const mount = async (onOpenRun: (run: ScheduledRunFinished) => void) => {
  let emit: ((run: ScheduledRunFinished) => void) | undefined;
  Object.defineProperty(window, 'canvasWorkspace', {
    configurable: true,
    value: {
      scheduled: {
        onRunFinished: (callback: (run: ScheduledRunFinished) => void) => {
          emit = callback;
          return () => undefined;
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
          <Harness onOpenRun={onOpenRun} />
        </AppShellProvider>
      </I18nProvider>,
    );
  });
  return (run: ScheduledRunFinished) => act(() => emit?.(run));
};

const toasts = () => [...document.querySelectorAll('.shell-toast')];

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useScheduledRunToasts', () => {
  it('keeps the completion toast up until it is acted on', async () => {
    vi.useFakeTimers();
    const onOpenRun = vi.fn();
    const emit = await mount(onOpenRun);

    const completedRun: ScheduledRunFinished = {
      taskId: 'daily-brief',
      title: 'Morning brief',
      ok: true,
      sessionId: 'session-from-run',
      trigger: 'schedule',
    } as ScheduledRunFinished;
    emit(completedRun);
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].textContent).toContain('Morning brief');

    // A run finishes while nobody is watching, so it must not expire on the
    // default toast timer.
    await act(async () => { vi.advanceTimersByTime(10 * 60_000); });
    expect(toasts()).toHaveLength(1);

    const action = document.querySelector<HTMLButtonElement>('.shell-toast__action');
    expect(action?.textContent).toContain('Open chat');
    await act(async () => { action?.click(); });

    expect(onOpenRun).toHaveBeenCalledWith(completedRun);
    expect(toasts()).toHaveLength(0);
  });

  it('does not announce a successful manual run the user is already watching', async () => {
    const emit = await mount(vi.fn());

    emit({
      taskId: 'daily-brief',
      title: 'Morning brief',
      ok: true,
      sessionId: 'manual-session',
      trigger: 'manual',
    } as ScheduledRunFinished);

    expect(toasts()).toHaveLength(0);
  });

  it('surfaces a failed run as an error toast carrying the reason', async () => {
    const emit = await mount(vi.fn());

    emit({
      taskId: 'daily-brief',
      title: 'Morning brief',
      ok: false,
      error: 'model unavailable',
      sessionId: 'failed-session',
      trigger: 'schedule',
    } as ScheduledRunFinished);

    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].textContent).toContain('model unavailable');
  });
});
