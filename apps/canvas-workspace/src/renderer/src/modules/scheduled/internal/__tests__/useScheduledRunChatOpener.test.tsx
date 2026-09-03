// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledRunFinished } from '../../../../../../shared/scheduled';
import type { AgentScope } from '../../../../types';
import { I18nProvider } from '../../../../i18n';
import { AppShellProvider } from '../../../../app/shell/AppShellProvider';

const dock = vi.hoisted(() => ({
  openScheduledChat: vi.fn(),
  refreshScheduledChat: vi.fn(),
}));
const setLocation = vi.hoisted(() => vi.fn());

vi.mock('../../../../shared/dockPort', () => ({ useRightDock: () => dock }));
vi.mock('wouter', () => ({ useLocation: () => ['/', setLocation] }));

import { useScheduledRunChatOpener } from '../useScheduledRunChatOpener';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

type OpenSession = (
  scope: AgentScope,
  sessionId: string,
  scopeLabel: string,
) => void | Promise<void>;

const mount = async (onOpenSessionInScope: OpenSession) => {
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
  const Harness = () => {
    useScheduledRunChatOpener({
      activeView: 'canvas',
      chatRoute: '/chat',
      onOpenSessionInScope,
    });
    return null;
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <I18nProvider>
        <AppShellProvider>
          <Harness />
        </AppShellProvider>
      </I18nProvider>,
    );
  });
  return (run: ScheduledRunFinished) => act(() => {
    for (const listener of [...listeners]) listener(run);
  });
};

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  dock.openScheduledChat.mockReset();
  dock.refreshScheduledChat.mockReset();
  setLocation.mockReset();
  vi.restoreAllMocks();
});

describe('useScheduledRunChatOpener', () => {
  it('opens the exact completed session in full-page Pulse AI', async () => {
    const openSession = vi.fn();
    const emit = await mount((scope, sessionId, scopeLabel) => {
      openSession(scope, sessionId, scopeLabel);
    });
    emit({
      taskId: 'daily-brief',
      title: 'Morning brief',
      ok: true,
      sessionId: 'scheduled-run-session',
      trigger: 'schedule',
    });

    await act(async () => {
      document.querySelector<HTMLButtonElement>('.shell-toast__action')?.click();
    });

    expect(openSession).toHaveBeenCalledWith(
      { kind: 'scheduled', taskId: 'daily-brief' },
      'scheduled-run-session',
      'Morning brief',
    );
    expect(dock.openScheduledChat).not.toHaveBeenCalled();
    expect(dock.refreshScheduledChat).toHaveBeenCalledWith('daily-brief');
    expect(setLocation).not.toHaveBeenCalled();
  });

  it('keeps the task-scope dock fallback when session creation failed', async () => {
    const openSession = vi.fn();
    const emit = await mount((scope, sessionId, scopeLabel) => {
      openSession(scope, sessionId, scopeLabel);
    });
    emit({
      taskId: 'daily-brief',
      title: 'Morning brief',
      ok: false,
      error: 'Could not create scheduled run session',
      trigger: 'schedule',
    });

    await act(async () => {
      document.querySelector<HTMLButtonElement>('.shell-toast__action')?.click();
    });

    expect(openSession).not.toHaveBeenCalled();
    expect(dock.openScheduledChat).toHaveBeenCalledWith('daily-brief');
    expect(dock.refreshScheduledChat).toHaveBeenCalledWith('daily-brief');
  });
});
