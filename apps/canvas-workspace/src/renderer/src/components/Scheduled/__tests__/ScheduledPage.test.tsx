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

  /**
   * The completion toast is dismissible and does not survive a restart, so the
   * list is the only lasting record that a run failed — and it rendered the
   * failure in the same muted grey as a success, with `lastError` never read
   * at all. The reason was reachable only by opening the conversation.
   */
  it('names the failure and its reason in the row', async () => {
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
              lastAttemptAt: Date.now() - 60_000,
              lastError: 'model unavailable',
              runCount: 1,
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
    await act(async () => { root?.render(renderPage()); });

    const outcome = host?.querySelector<HTMLElement>('.scheduled-page__last-run');
    expect(outcome?.className).toContain('scheduled-page__last-run--error');
    expect(outcome?.textContent).toContain('Failed');
    expect(outcome?.textContent).toContain('model unavailable');

    // The dot is the only status left once the dock squeezes the columns out,
    // so it has to carry the failure too.
    const status = host?.querySelector<HTMLElement>('.scheduled-page__status');
    expect(status?.className).toContain('scheduled-page__status--failed');
    expect(status?.getAttribute('title')).toContain('Failed');
  });

  /**
   * `lastSuccessAt` stores the attempt's START (`attemptedAt` is captured
   * before the run), so "Completed 09:00" was falsifiable by anyone who
   * watched a run take twelve minutes.
   */
  it('does not claim a run completed at the minute it started', async () => {
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
              lastAttemptAt: Date.now() - 60_000,
              lastSuccessAt: Date.now() - 60_000,
              runCount: 1,
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
    await act(async () => { root?.render(renderPage()); });

    const outcome = host?.querySelector<HTMLElement>('.scheduled-page__last-run');
    expect(outcome?.textContent).toContain('Last run');
    expect(outcome?.textContent).not.toContain('Completed');
    expect(outcome?.className).not.toContain('--error');
  });

  /**
   * The editor always submits the whole form, and `update` re-anchors the next
   * run whenever a schedule arrives — so sending the untouched cadence back
   * pushed the pending run a full period out. Fixing a typo must cost nothing.
   */
  it('sends only the fields an edit actually changed', async () => {
    const update = vi.fn(async () => ({ ok: true, task: { id: 'daily-brief' } }));
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: {
        agent: { polishScheduledPrompt: vi.fn() },
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
          update,
        },
      },
    });

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root?.render(renderPage()); });

    const click = async (label: string) => {
      const button = [...document.querySelectorAll<HTMLButtonElement>('button')]
        .find((candidate) => candidate.textContent?.trim() === label);
      await act(async () => {
        button?.click();
        await Promise.resolve();
      });
    };

    await click('Edit task');
    const titleInput = document.querySelector<HTMLInputElement>('input');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(titleInput, 'Daily brief (mail)');
      titleInput?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click('Save task');

    expect(update).toHaveBeenCalledWith('daily-brief', { title: 'Daily brief (mail)' });
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
