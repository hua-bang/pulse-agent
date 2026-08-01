// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';

const captured = vi.hoisted(() => ({
  mountCount: 0,
  refreshKey: -1 as string | number,
}));

vi.mock('../../chat/lazy', () => ({
  ChatPanelLazy: ({ sessionRefreshKey, banner }: {
    sessionRefreshKey?: string | number;
    banner?: React.ReactNode;
  }) => {
    const [draft, setDraft] = useState(() => {
      captured.mountCount += 1;
      return '';
    });
    captured.refreshKey = sessionRefreshKey ?? -1;
    return (
      <>
        {banner}
        <input
          aria-label="Mock draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </>
    );
  },
}));

import { ScheduledChatPanel } from '../ScheduledChatPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  captured.mountCount = 0;
  captured.refreshKey = -1;
});

describe('ScheduledChatPanel', () => {
  it('refreshes history without remounting or losing the composer draft', async () => {
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: {
        scheduled: {
          list: vi.fn(async () => ({ ok: true, tasks: [] })),
          onChanged: vi.fn(() => () => undefined),
        },
      },
    });
    host = document.createElement('div');
    root = createRoot(host);
    const render = (revision: number) => (
      <I18nProvider>
        <ScheduledChatPanel
          taskId="daily"
          revision={revision}
          allWorkspaces={[]}
          onClose={vi.fn()}
          onExitTaskChat={vi.fn()}
          onOpenAppSettings={vi.fn()}
          onTurnComplete={vi.fn()}
          onOpenSessionInScope={vi.fn()}
        />
      </I18nProvider>
    );

    await act(async () => root?.render(render(1)));
    const input = host.querySelector<HTMLInputElement>('input')!;
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(input, 'keep this draft');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => root?.render(render(2)));

    expect(captured.mountCount).toBe(1);
    expect(captured.refreshKey).toBe(2);
    expect(host.querySelector<HTMLInputElement>('input')?.value).toBe('keep this draft');
  });

  /**
   * `scheduledChatTaskId` overrides the dock's Pulse AI tab until something
   * calls `openChat`, and the tab keeps its generic label — so arriving here
   * from a completion toast left the user in an unnamed conversation whose
   * only exit was collapse-then-reopen from the toolbar.
   */
  it('names the task and offers a one-press way back to the ordinary chat', async () => {
    const onExitTaskChat = vi.fn();
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: {
        scheduled: {
          list: vi.fn(async () => ({
            ok: true,
            tasks: [{
              id: 'daily',
              title: 'Morning brief',
              prompt: 'Summarize what needs my attention.',
              schedule: { kind: 'daily', timeOfDay: '09:00' },
              enabled: true,
              source: 'user',
              createdAt: 1,
              updatedAt: 1,
              nextRunAt: 2,
              runCount: 0,
              status: 'idle',
            }],
          })),
          onChanged: vi.fn(() => () => undefined),
        },
      },
    });
    host = document.createElement('div');
    root = createRoot(host);
    await act(async () => root?.render(
      <I18nProvider>
        <ScheduledChatPanel
          taskId="daily"
          revision={1}
          allWorkspaces={[]}
          onClose={vi.fn()}
          onExitTaskChat={onExitTaskChat}
          onOpenAppSettings={vi.fn()}
          onTurnComplete={vi.fn()}
        />
      </I18nProvider>,
    ));

    const identity = host.querySelector('.scheduled-chat-identity');
    expect(identity?.textContent).toContain('Morning brief');
    expect(identity?.textContent).toContain('Daily at 09:00');

    // Idle: identity is present even with no run in flight and no failure.
    expect(host.querySelector('.scheduled-chat-status')).toBeNull();

    const exit = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Back to Pulse AI'));
    await act(async () => { exit?.click(); });
    expect(onExitTaskChat).toHaveBeenCalledTimes(1);
  });
});
