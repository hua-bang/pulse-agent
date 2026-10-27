// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n';
import { AppShellProvider } from '../../../../app/shell/AppShellProvider';

const dock = vi.hoisted(() => ({ openScheduledChat: vi.fn() }));
vi.mock('../../../../shared/dockPort', () => ({ useRightDock: () => dock }));

import { ScheduledPage } from '../ScheduledPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const renderPage = (onAskAi?: (task: { id: string; title: string }) => void) => (
  <I18nProvider>
    <AppShellProvider>
      <ScheduledPage onAskAi={onAskAi} />
    </AppShellProvider>
  </I18nProvider>
);

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  dock.openScheduledChat.mockReset();
  vi.restoreAllMocks();
});

const baseTask = {
  id: 'daily-brief',
  title: 'Daily brief',
  prompt: 'Summarize what needs my attention.',
  schedule: { kind: 'daily', timeOfDay: '09:00' },
  enabled: true,
  source: 'user',
  createdAt: 1,
  updatedAt: 1,
  nextRunAt: Date.now() + 60_000,
  runCount: 0,
  status: 'idle',
};

const mount = async (onAskAi?: (task: { id: string; title: string }) => void) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(renderPage(onAskAi));
  });
};

describe('ScheduledPage', () => {
  it('lists scheduled tasks without any navigation target in the row', async () => {
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: {
        scheduled: {
          list: vi.fn(async () => ({
            ok: true,
            tasks: [{
              id: 'daily-brief',
              title: 'Daily brief',
              prompt: 'Summarize what needs my attention.',
              schedule: { kind: 'daily', timeOfDay: '09:00' },
              enabled: true,
              source: 'user',
              createdAt: 1,
              updatedAt: 1,
              nextRunAt: Date.now() + 60_000,
              runCount: 0,
              status: 'idle',
            }],
          })),
          onChanged: vi.fn(() => () => undefined),
        },
      },
    });

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(renderPage());
    });

    const row = host.querySelector<HTMLElement>('[data-task-id="daily-brief"]');
    expect(row?.textContent).toContain('Daily brief');

    // The row is presentational: no row-wide button, and no per-row chat
    // entry. Every control is one of the explicit task actions.
    expect(row?.querySelector('.scheduled-page__row-main')?.tagName).toBe('DIV');
    expect([...host.querySelectorAll('button')].map((button) =>
      button.textContent?.trim() || button.getAttribute('aria-label')))
      .toEqual(['Create task', 'Run now', 'Pause schedule', 'Edit task', 'Delete task']);
  });

  it('opens the latest successful run in the dock from the last-run cell', async () => {
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: {
        scheduled: {
          list: vi.fn(async () => ({
            ok: true,
            tasks: [{
              ...baseTask,
              lastAttemptAt: 5,
              lastSuccessAt: 5,
              lastSessionId: 'latest-session',
              runCount: 1,
            }],
          })),
          onChanged: vi.fn(() => () => undefined),
        },
      },
    });

    await mount();
    await act(async () => {
      host?.querySelector<HTMLButtonElement>('[title="Open this run’s conversation"]')?.click();
    });
    expect(dock.openScheduledChat).toHaveBeenCalledWith('daily-brief', 'latest-session');
  });

  it('shows the failure reason and never links a failed run to an older result', async () => {
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: {
        scheduled: {
          list: vi.fn(async () => ({
            ok: true,
            tasks: [{
              ...baseTask,
              lastAttemptAt: 9,
              lastSuccessAt: 5,
              lastSessionId: 'older-session',
              lastError: 'Model quota exceeded',
              runCount: 2,
            }],
          })),
          onChanged: vi.fn(() => () => undefined),
        },
      },
    });

    await mount();
    const lastRun = host?.querySelector('.scheduled-page__last-run--failed');
    expect(lastRun?.textContent).toContain('Model quota exceeded');
    expect(host?.querySelector('[title="Open this run’s conversation"]')).toBeNull();
  });

  it('starts a fresh scheduled session and opens it in the dock beside the list', async () => {
    const runNow = vi.fn(async () => ({
      ok: true,
      sessionId: 'manual-run-session',
    }));
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: {
        scheduled: {
          list: vi.fn(async () => ({
            ok: true,
            tasks: [{
              id: 'daily-brief',
              title: 'Daily brief',
              prompt: 'Summarize what needs my attention.',
              schedule: { kind: 'interval', intervalMinutes: 30 },
              enabled: true,
              source: 'user',
              createdAt: 1,
              updatedAt: 1,
              nextRunAt: Date.now() + 60_000,
              runCount: 0,
              status: 'idle',
            }],
          })),
          onChanged: vi.fn(() => () => undefined),
          runNow,
        },
      },
    });

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(renderPage());
    });

    await act(async () => {
      host?.querySelector<HTMLButtonElement>('[aria-label="Run now"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(runNow).toHaveBeenCalledWith('daily-brief');
    expect(dock.openScheduledChat).toHaveBeenCalledWith('daily-brief', 'manual-run-session');
  });

  it('shows an immediate running state and prevents duplicate manual runs', async () => {
    let finishStart: ((value: { ok: boolean; sessionId: string }) => void) | undefined;
    const runNow = vi.fn(() => new Promise<{ ok: boolean; sessionId: string }>((resolve) => {
      finishStart = resolve;
    }));
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: {
        scheduled: {
          list: vi.fn(async () => ({
            ok: true,
            tasks: [{
              id: 'daily-brief',
              title: 'Daily brief',
              prompt: 'Summarize what needs my attention.',
              schedule: { kind: 'interval', intervalMinutes: 30 },
              enabled: true,
              source: 'user',
              createdAt: 1,
              updatedAt: 1,
              nextRunAt: Date.now() + 60_000,
              runCount: 0,
              status: 'idle',
            }],
          })),
          onChanged: vi.fn(() => () => undefined),
          runNow,
        },
      },
    });

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(renderPage());
    });

    await act(async () => {
      host?.querySelector<HTMLButtonElement>('[aria-label="Run now"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const runningButton = host.querySelector<HTMLButtonElement>('[aria-label="Running scheduled task"]');
    expect(runningButton?.disabled).toBe(true);
    expect(runningButton?.textContent).toContain('Running');
    runningButton?.click();
    expect(runNow).toHaveBeenCalledTimes(1);
    expect(dock.openScheduledChat).not.toHaveBeenCalled();

    await act(async () => {
      finishStart?.({ ok: true, sessionId: 'manual-run-session' });
      await Promise.resolve();
    });
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Run now"]')?.disabled).toBe(false);
    expect(dock.openScheduledChat).toHaveBeenCalledWith('daily-brief', 'manual-run-session');
  });

  it('asks the side chat about one task from its row', async () => {
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: {
        scheduled: {
          list: vi.fn(async () => ({ ok: true, tasks: [baseTask] })),
          onChanged: vi.fn(() => () => undefined),
        },
      },
    });
    const onAskAi = vi.fn();
    await mount(onAskAi);

    const ask = host?.querySelector<HTMLButtonElement>('[aria-label="Ask AI about this task"]');
    expect(ask).not.toBeNull();
    act(() => ask?.click());

    expect(onAskAi).toHaveBeenCalledWith(expect.objectContaining({ id: 'daily-brief', title: 'Daily brief' }));
    expect(dock.openScheduledChat).not.toHaveBeenCalled();
  });
});
