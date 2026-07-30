// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledRunProgress, ScheduledTask } from '../../../../../shared/scheduled';
import { I18nProvider } from '../../../i18n';

const captured = vi.hoisted(() => ({
  pendingLabel: undefined as string | undefined,
}));

vi.mock('../../chat/lazy', () => ({
  ChatPanelLazy: ({ banner, pendingLabel }: { banner?: ReactNode; pendingLabel?: string }) => {
    captured.pendingLabel = pendingLabel;
    return <div>{banner}</div>;
  },
}));

import { ScheduledChatPanel } from '../ScheduledChatPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const runningTask: ScheduledTask = {
  id: 'daily-brief',
  title: 'Morning brief',
  prompt: 'Summarize what needs my attention.',
  schedule: { kind: 'daily', timeOfDay: '09:00' },
  enabled: true,
  source: 'user',
  createdAt: 1,
  updatedAt: 1,
  nextRunAt: 2,
  runCount: 1,
  status: 'running',
};

const snapshot: ScheduledRunProgress = {
  taskId: 'daily-brief',
  startedAt: Date.now() - 80_000,
  updatedAt: Date.now(),
  phase: 'tool',
  toolCalls: 1,
  steps: [{ index: 1, name: 'notion_search', status: 'running', startedAt: Date.now() - 2_000 }],
};

const cancelRun = vi.fn(async () => ({ ok: true }));

const mount = async () => {
  let emit: ((progress: ScheduledRunProgress) => void) | undefined;
  Object.defineProperty(window, 'canvasWorkspace', {
    configurable: true,
    value: {
      scheduled: {
        list: vi.fn(async () => ({ ok: true, tasks: [runningTask] })),
        onChanged: vi.fn(() => () => undefined),
        getRunProgress: vi.fn(async () => ({ ok: true, progress: snapshot })),
        onRunProgress: (callback: (progress: ScheduledRunProgress) => void) => {
          emit = callback;
          return () => undefined;
        },
        cancelRun,
      },
    },
  });

  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <I18nProvider>
        <ScheduledChatPanel
          taskId="daily-brief"
          revision={0}
          allWorkspaces={[]}
          onClose={() => undefined}
          onOpenAppSettings={() => undefined}
          onTurnComplete={() => undefined}
        />
      </I18nProvider>,
    );
  });
  return (progress: ScheduledRunProgress) => act(() => emit?.(progress));
};

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  cancelRun.mockClear();
  captured.pendingLabel = undefined;
  vi.restoreAllMocks();
});

describe('ScheduledChatPanel run status', () => {
  /**
   * The panel is usually opened AFTER the run started — nobody is watching a
   * background task at 09:25 — so the current step has to come from the
   * main-process snapshot, not from events that already happened.
   */
  it('catches up on an in-flight run from the snapshot, with the run elapsed time', async () => {
    await mount();

    const status = host?.querySelector('.scheduled-chat-status');
    expect(status?.textContent).toContain('Step 1 · calling notion_search');
    // Elapsed is measured from the RUN's start, not from mount.
    expect(status?.textContent).toContain('running 1m 20s');
    expect(captured.pendingLabel).toContain('calling notion_search');
  });

  it('follows the run into its next phase', async () => {
    const emit = await mount();

    emit({ ...snapshot, phase: 'writing', steps: [{ ...snapshot.steps[0], status: 'done' }] });

    expect(host?.querySelector('.scheduled-chat-status')?.textContent).toContain('Writing the result');
    expect(captured.pendingLabel).toContain('Writing the result');
  });

  it('stops the run from the status strip and reflects the pending stop', async () => {
    const emit = await mount();

    const stop = host?.querySelector<HTMLButtonElement>('[aria-label="Stop"]');
    await act(async () => { stop?.click(); });
    expect(cancelRun).toHaveBeenCalledWith('daily-brief');

    emit({ ...snapshot, cancelRequested: true });
    expect(host?.querySelector('.scheduled-chat-status')?.textContent).toContain('Stopping this run');
    expect(host?.querySelector<HTMLButtonElement>('[aria-label="Stop"]')?.disabled).toBe(true);
  });
});
