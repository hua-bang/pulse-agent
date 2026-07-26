// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { AppShellProvider } from '../../AppShellProvider';
import { ScheduledPage } from '../ScheduledPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

describe('ScheduledPage', () => {
  it('lists scheduled tasks and opens the task chat when a row is clicked', async () => {
    const onOpenTask = vi.fn();
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
              intervalMinutes: 24 * 60,
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
      root?.render(
        <I18nProvider>
          <AppShellProvider>
            <ScheduledPage onOpenTask={onOpenTask} />
          </AppShellProvider>
        </I18nProvider>,
      );
    });

    const row = host.querySelector<HTMLButtonElement>('[data-task-id="daily-brief"]');
    expect(row?.textContent).toContain('Daily brief');
    act(() => row?.click());
    expect(onOpenTask).toHaveBeenCalledWith('daily-brief');
  });

  it('opens task chat immediately when run-now starts in the background', async () => {
    const onOpenTask = vi.fn();
    const runNow = vi.fn(() => new Promise<never>(() => undefined));
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
              intervalMinutes: 30,
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
      root?.render(
        <I18nProvider>
          <AppShellProvider>
            <ScheduledPage onOpenTask={onOpenTask} />
          </AppShellProvider>
        </I18nProvider>,
      );
    });

    act(() => host?.querySelector<HTMLButtonElement>('[aria-label="Run now"]')?.click());
    expect(runNow).toHaveBeenCalledWith('daily-brief');
    expect(onOpenTask).toHaveBeenCalledWith('daily-brief');
  });
});
