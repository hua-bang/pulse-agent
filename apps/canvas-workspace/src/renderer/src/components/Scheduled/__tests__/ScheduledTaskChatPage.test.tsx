// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentScope } from '../../../../../shared/agent-chat';
import { I18nProvider } from '../../../i18n';
import { AppShellProvider } from '../../AppShellProvider';

const captured = vi.hoisted(() => ({
  scope: null as AgentScope | null,
  bannerPresent: false,
  mountCount: 0,
}));

vi.mock('../../chat/ChatPageBody', () => ({
  ChatPageBody: ({ agentScope, fixedChat }: {
    agentScope: AgentScope;
    fixedChat?: { title: string; banner?: unknown };
  }) => {
    useState(() => {
      captured.mountCount += 1;
      return captured.mountCount;
    });
    captured.scope = agentScope;
    captured.bannerPresent = fixedChat?.banner != null;
    return (
      <main>
        <h1>{fixedChat?.title}</h1>
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
  captured.bannerPresent = false;
  captured.mountCount = 0;
  vi.restoreAllMocks();
});

describe('ScheduledTaskChatPage', () => {
  it('opens the task in its isolated chat scope without a duplicate definition banner', async () => {
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
    expect(host.textContent).toContain('Daily brief');
    expect(captured.bannerPresent).toBe(false);
  });

  it('keeps the composer mounted when task run metadata changes', async () => {
    let emitChanged: ((tasks: Array<Record<string, unknown>>) => void) | undefined;
    const task = {
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
    };
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: {
        scheduled: {
          list: vi.fn(async () => ({ ok: true, tasks: [task] })),
          onChanged: vi.fn((handler) => {
            emitChanged = handler;
            return () => undefined;
          }),
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
    expect(captured.mountCount).toBe(1);

    await act(async () => {
      emitChanged?.([{
        ...task,
        lastAttemptAt: Date.now(),
        lastSuccessAt: Date.now(),
      }]);
    });

    expect(captured.mountCount).toBe(1);
  });
});
