// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { ChatSessionsRail, type UnifiedSession } from '../ChatSessionsRail';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const sessions: UnifiedSession[] = [
  {
    sessionId: 'session-a',
    workspaceId: 'workspace-a',
    workspaceName: 'Workspace A',
    date: '2026-07-29',
    messageCount: 2,
    preview: 'First conversation',
  },
  {
    sessionId: 'session-b',
    workspaceId: 'workspace-a',
    workspaceName: 'Workspace A',
    date: '2026-07-28',
    messageCount: 1,
    preview: 'Second conversation',
  },
  {
    sessionId: 'session-c',
    workspaceId: 'workspace-b',
    workspaceName: 'Workspace B',
    date: '2026-07-27',
    messageCount: 1,
    preview: 'Third conversation',
  },
];

const globalSession: UnifiedSession = {
  sessionId: 'global-session',
  workspaceId: '__global_chat__',
  workspaceName: 'Global Chat',
  date: '2026-07-29',
  messageCount: 1,
  preview: 'Global conversation',
};

describe('ChatSessionsRail workspace tree', () => {
  it('groups sessions by workspace and lets each folder collapse independently', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <I18nProvider>
          <ChatSessionsRail
            allSessions={sessions}
            onNewSession={vi.fn()}
            onSelectSession={vi.fn()}
          />
        </I18nProvider>,
      );
    });

    const folders = Array.from(host.querySelectorAll<HTMLButtonElement>('.chat-page-rail-folder'));
    expect(folders).toHaveLength(2);
    expect(folders[0].textContent).toContain('Workspace A');
    expect(folders[0].textContent).toContain('2');
    expect(host.textContent).toContain('First conversation');
    expect(host.textContent).not.toContain('Third conversation');

    await act(async () => {
      folders[1].click();
    });

    expect(folders[1].getAttribute('aria-expanded')).toBe('true');
    expect(host.textContent).toContain('Third conversation');

    await act(async () => {
      folders[0].click();
    });

    expect(folders[0].getAttribute('aria-expanded')).toBe('false');
    expect(host.textContent).not.toContain('First conversation');
    expect(host.textContent).not.toContain('Second conversation');
    expect(host.textContent).toContain('Third conversation');
  });

  it('keeps folder and session order stable when the current session changes', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const render = async (value: UnifiedSession[]) => {
      await act(async () => {
        root?.render(
          <I18nProvider>
            <ChatSessionsRail
              allSessions={value}
              onNewSession={vi.fn()}
              onSelectSession={vi.fn()}
            />
          </I18nProvider>,
        );
      });
    };

    await render(sessions);
    const scroll = host.querySelector<HTMLElement>('.chat-page-rail-scroll')!;
    scroll.scrollTop = 120;
    const initialFolders = Array.from(
      host.querySelectorAll('.chat-page-rail-folder-name'),
      (node) => node.textContent,
    );
    const initialItems = Array.from(
      host.querySelectorAll('.chat-page-rail-item-text'),
      (node) => node.textContent,
    );

    await render(sessions.slice().reverse().map((session) => ({
      ...session,
      isCurrent: session.sessionId === 'session-b',
    })));

    expect(Array.from(
      host.querySelectorAll('.chat-page-rail-folder-name'),
      (node) => node.textContent,
    )).toEqual(initialFolders);
    expect(Array.from(
      host.querySelectorAll('.chat-page-rail-item-text'),
      (node) => node.textContent,
    )).toEqual(initialItems);
    expect(scroll.scrollTop).toBe(120);
    expect(host.querySelector('.chat-page-rail-item--active')?.textContent).toContain('Second conversation');
  });

  it('always places Global Chat before workspace folders', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <I18nProvider>
          <ChatSessionsRail
            allSessions={[...sessions, globalSession]}
            onNewSession={vi.fn()}
            onSelectSession={vi.fn()}
          />
        </I18nProvider>,
      );
    });

    expect(host.querySelector('.chat-page-rail-folder-name')?.textContent).toBe('Global Chat');
  });

  it('opens the active folder and collapses other folders by default', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <I18nProvider>
          <ChatSessionsRail
            allSessions={[
              { ...globalSession, isCurrent: true },
              ...sessions,
            ]}
            onNewSession={vi.fn()}
            onSelectSession={vi.fn()}
          />
        </I18nProvider>,
      );
    });

    const folders = Array.from(host.querySelectorAll<HTMLButtonElement>('.chat-page-rail-folder'));
    expect(folders[0].getAttribute('aria-expanded')).toBe('true');
    expect(folders[1].getAttribute('aria-expanded')).toBe('false');
    expect(host.textContent).toContain('Global conversation');
    expect(host.textContent).not.toContain('First conversation');
  });
});
