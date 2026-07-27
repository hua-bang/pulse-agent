// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { AppShellProvider } from '../../AppShellProvider';
import { RightDockProvider, useRightDockState } from '../../RightDock';
import type { DockState } from '../../RightDock/dock-store';
import { ScheduledPage } from '../ScheduledPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let dockState: DockState | undefined;

const DockStateProbe = () => {
  dockState = useRightDockState();
  return null;
};

const renderPage = () => (
  <I18nProvider>
    <AppShellProvider>
      <RightDockProvider>
        <DockStateProbe />
        <ScheduledPage />
      </RightDockProvider>
    </AppShellProvider>
  </I18nProvider>
);

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  dockState = undefined;
  vi.restoreAllMocks();
});

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
    expect([...host.querySelectorAll('button')].map((button) => button.textContent?.trim()))
      .toEqual(['Create task', 'Pause', 'Run now', 'Edit task', 'Delete task']);
  });

  it('starts a fresh scheduled session and opens it in Pulse AI', async () => {
    const runNow = vi.fn(async () => ({ ok: true }));
    const newSession = vi.fn(async () => ({ ok: true }));
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: {
        agent: { newSession },
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
    expect(newSession).toHaveBeenCalledWith({
      scope: { kind: 'scheduled', taskId: 'daily-brief' },
    });
    expect(runNow).toHaveBeenCalledWith('daily-brief');
    expect(dockState).toMatchObject({
      expanded: true,
      scheduledChatTaskId: 'daily-brief',
      scheduledChatRevision: 2,
    });
  });

  it('shows an immediate running state and prevents duplicate manual runs', async () => {
    let finishRun: ((value: { ok: boolean }) => void) | undefined;
    const runNow = vi.fn(() => new Promise<{ ok: boolean }>((resolve) => {
      finishRun = resolve;
    }));
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: {
        agent: { newSession: vi.fn(async () => ({ ok: true })) },
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
    expect(dockState).toMatchObject({
      expanded: true,
      scheduledChatTaskId: 'daily-brief',
      scheduledChatRevision: 1,
    });

    await act(async () => {
      finishRun?.({ ok: true });
      await Promise.resolve();
    });
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Run now"]')?.disabled).toBe(false);
    expect(dockState?.scheduledChatRevision).toBe(2);
  });
});
