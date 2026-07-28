// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentScope } from '../../../../../shared/agent-chat';
import type { ScheduledRunProgress, ScheduledTask } from '../../../../../shared/scheduled';
import { I18nProvider } from '../../../i18n';
import { AppShellProvider } from '../../AppShellProvider';

const captured = vi.hoisted(() => ({
  scope: null as AgentScope | null,
  bannerPresent: false,
  pendingLabel: undefined as string | undefined,
}));

vi.mock('../../chat/ChatPageBody', () => ({
  ChatPageBody: ({ agentScope, fixedChat }: {
    agentScope: AgentScope;
    fixedChat?: { title: string; banner?: ReactNode; pendingLabel?: string };
  }) => {
    captured.scope = agentScope;
    captured.bannerPresent = fixedChat?.banner != null;
    captured.pendingLabel = fixedChat?.pendingLabel;
    return (
      <main>
        <h1>{fixedChat?.title}</h1>
        {fixedChat?.banner}
      </main>
    );
  },
}));

import { ScheduledTaskChatPage } from '../ScheduledTaskChatPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const task = (overrides: Partial<ScheduledTask> = {}): ScheduledTask => ({
  id: 'daily-brief',
  title: 'Daily brief',
  prompt: 'Summarize what needs my attention.',
  schedule: { kind: 'daily', timeOfDay: '09:00' },
  enabled: true,
  source: 'user',
  createdAt: 1,
  updatedAt: 1,
  nextRunAt: Date.now() + 60_000,
  runCount: 1,
  status: 'idle',
  ...overrides,
});

const mount = async (current: ScheduledTask, runs: ScheduledRunProgress[] = []) => {
  Object.defineProperty(window, 'canvasWorkspace', {
    configurable: true,
    value: {
      scheduled: {
        list: vi.fn(async () => ({ ok: true, tasks: [current] })),
        onChanged: vi.fn(() => () => undefined),
        progress: vi.fn(async () => ({ ok: true, runs })),
        onRunProgress: vi.fn(() => () => undefined),
        onRunFinished: vi.fn(() => () => undefined),
        runNow: vi.fn(),
        update: vi.fn(),
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
          <ScheduledTaskChatPage
            taskId="daily-brief"
            onExit={() => undefined}
            onOpenAppSettings={() => undefined}
          />
        </AppShellProvider>
      </I18nProvider>,
    );
  });
};

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  captured.scope = null;
  captured.bannerPresent = false;
  captured.pendingLabel = undefined;
  vi.restoreAllMocks();
});

describe('ScheduledTaskChatPage', () => {
  it('opens the task in its isolated chat scope without a duplicate definition banner', async () => {
    await mount(task({ lastAttemptAt: Date.now(), lastSuccessAt: Date.now() }));

    expect(captured.scope).toEqual({ kind: 'scheduled', taskId: 'daily-brief' });
    expect(host?.textContent).toContain('Daily brief');
    // The task's own definition (prompt, cadence, id) belongs to the list row.
    expect(captured.bannerPresent).toBe(false);
    expect(captured.pendingLabel).toBeUndefined();
  });

  /**
   * The full-page chat used to pass no banner at all, so a failed run left
   * this surface blank while the dock panel showed the reason.
   */
  it('surfaces the reason a run failed', async () => {
    await mount(task({ lastAttemptAt: Date.now(), lastError: 'Model unavailable' }));

    expect(captured.bannerPresent).toBe(true);
    expect(host?.querySelector('.scheduled-chat-status--error')?.textContent)
      .toContain('Model unavailable');
  });

  it('shows what an in-flight run is doing instead of a frozen wait message', async () => {
    const startedAt = Date.now() - 135_000;
    await mount(
      task({ status: 'running', lastAttemptAt: startedAt }),
      [{
        taskId: 'daily-brief',
        startedAt,
        updatedAt: Date.now(),
        activity: 'tool',
        toolName: 'notion_search',
        steps: 2,
      }],
    );

    const line = 'Running for 2:15 · Using notion_search · step 2';
    expect(host?.querySelector('.scheduled-chat-status__activity')?.textContent).toBe(line);
    // The in-conversation placeholder carries the same live line, so progress
    // is visible without scrolling back up to the banner.
    expect(captured.pendingLabel).toBe(line);
  });
});
