// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentScope } from '../../../../../shared/agent-chat';
import { I18nProvider } from '../../../i18n';
import { AppShellProvider } from '../../AppShellProvider';

const captured = vi.hoisted(() => ({
  scope: null as AgentScope | null,
}));

vi.mock('../../chat/ChatPageBody', () => ({
  ChatPageBody: ({ agentScope, fixedChat }: {
    agentScope: AgentScope;
    fixedChat?: { title: string; banner?: ReactNode };
  }) => {
    captured.scope = agentScope;
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

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  captured.scope = null;
  vi.restoreAllMocks();
});

describe('ScheduledTaskChatPage', () => {
  it('opens the task in its isolated chat scope with scheduling context', async () => {
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
              lastAttemptAt: Date.now(),
              lastError: 'Model unavailable',
              runCount: 1,
              status: 'idle',
            }],
          })),
          onChanged: vi.fn(() => () => undefined),
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

    expect(captured.scope).toEqual({ kind: 'scheduled', taskId: 'daily-brief' });
    expect(host.textContent).toContain('Automation: Daily brief');
    expect(host.textContent).toContain('Summarize what needs my attention.');
    expect(host.textContent).toContain('Last run failed: Model unavailable');
  });
});
