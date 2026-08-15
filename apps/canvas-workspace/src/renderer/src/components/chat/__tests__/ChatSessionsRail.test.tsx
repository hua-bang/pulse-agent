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
  it('shows every real workspace and starts a draft from its row action', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const onNewSessionInWorkspace = vi.fn();

    await act(async () => {
      root?.render(
        <I18nProvider>
          <ChatSessionsRail
            allSessions={[]}
            workspaces={[
              { id: 'workspace-a', name: 'Workspace A' },
              { id: 'workspace-empty', name: 'Empty workspace' },
            ]}
            onNewSession={vi.fn()}
            onNewSessionInWorkspace={onNewSessionInWorkspace}
            onSelectSession={vi.fn()}
          />
        </I18nProvider>,
      );
    });

    expect(Array.from(
      host.querySelectorAll('.chat-page-rail-folder-name'),
      node => node.textContent,
    )).toEqual(['Empty workspace', 'Workspace A']);

    const newChat = host.querySelector<HTMLButtonElement>(
      '[aria-label="New chat in Empty workspace"]',
    );
    expect(newChat).not.toBeNull();
    await act(async () => newChat?.click());

    expect(onNewSessionInWorkspace).toHaveBeenCalledWith('workspace-empty', newChat);
  });

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

  it('preserves manually expanded folders when the current session changes', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const renderRail = async (value: UnifiedSession[]) => {
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

    await renderRail(sessions.map((session) => ({
      ...session,
      isCurrent: session.sessionId === 'session-a',
    })));
    let folders = Array.from(host.querySelectorAll<HTMLButtonElement>('.chat-page-rail-folder'));
    await act(async () => folders[1].click());
    expect(folders[1].getAttribute('aria-expanded')).toBe('true');

    await renderRail(sessions.map((session) => ({
      ...session,
      isCurrent: session.sessionId === 'session-b',
    })));
    folders = Array.from(host.querySelectorAll<HTMLButtonElement>('.chat-page-rail-folder'));
    expect(folders[1].getAttribute('aria-expanded')).toBe('true');
  });

  it('does not reopen a manually collapsed active folder when the session list refreshes', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const renderRail = async () => {
      await act(async () => {
        root?.render(
          <I18nProvider>
            <ChatSessionsRail
              allSessions={sessions.map((session) => ({
                ...session,
                isCurrent: session.sessionId === 'session-a',
              }))}
              onNewSession={vi.fn()}
              onSelectSession={vi.fn()}
            />
          </I18nProvider>,
        );
      });
    };

    await renderRail();
    let folders = Array.from(host.querySelectorAll<HTMLButtonElement>('.chat-page-rail-folder'));
    await act(async () => folders[0].click());
    expect(folders[0].getAttribute('aria-expanded')).toBe('false');

    await renderRail();
    folders = Array.from(host.querySelectorAll<HTMLButtonElement>('.chat-page-rail-folder'));
    expect(folders[0].getAttribute('aria-expanded')).toBe('false');
  });

  it('shows global sessions as an ungrouped list before workspace folders', async () => {
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

    expect(host.querySelector('.chat-page-rail-group--global .chat-page-rail-item-text')?.textContent)
      .toBe('Global conversation');
    expect(Array.from(
      host.querySelectorAll('.chat-page-rail-folder-name'),
      node => node.textContent,
    )).toEqual(['Workspace A', 'Workspace B']);
  });

  it('orders same-day sessions by their precise update time', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <I18nProvider>
          <ChatSessionsRail
            allSessions={[
              { ...sessions[0], sessionId: 'session-z', preview: 'Older', updatedAt: 100 },
              { ...sessions[0], sessionId: 'session-a', preview: 'Newer', updatedAt: 200 },
            ]}
            onNewSession={vi.fn()}
            onSelectSession={vi.fn()}
          />
        </I18nProvider>,
      );
    });

    expect(Array.from(
      host.querySelectorAll('.chat-page-rail-item-text'),
      (node) => node.textContent,
    )).toEqual(['Newer', 'Older']);
  });

  it('keeps session rows title-only without leading or metadata columns', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <I18nProvider>
          <ChatSessionsRail
            allSessions={[
              { ...sessions[0], sessionId: 'repeat-a', preview: 'Repeated', updatedAt: 100, messageCount: 2 },
              { ...sessions[0], sessionId: 'repeat-b', preview: 'Repeated', updatedAt: 200, messageCount: 9 },
            ]}
            onNewSession={vi.fn()}
            onSelectSession={vi.fn()}
          />
        </I18nProvider>,
      );
    });

    expect(host.querySelectorAll('.chat-page-rail-item')).toHaveLength(2);
    expect(host.querySelector('.chat-page-rail-item > svg')).toBeNull();
    expect(host.querySelector('.chat-page-rail-item-meta')).toBeNull();
  });

  it('previews ten sessions in a large folder and lets the user show all or fewer', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const manySessions = Array.from({ length: 15 }, (_, index): UnifiedSession => ({
      sessionId: `session-${index}`,
      workspaceId: 'workspace-a',
      workspaceName: 'Workspace A',
      date: `2026-07-${String(30 - index).padStart(2, '0')}`,
      messageCount: 1,
      preview: `Conversation ${index + 1}`,
      isCurrent: index === 0,
    }));

    await act(async () => {
      root?.render(
        <I18nProvider>
          <ChatSessionsRail
            allSessions={manySessions}
            onNewSession={vi.fn()}
            onSelectSession={vi.fn()}
          />
        </I18nProvider>,
      );
    });

    expect(host.querySelectorAll('.chat-page-rail-item')).toHaveLength(10);
    let more = host.querySelector<HTMLButtonElement>('.chat-page-rail-more');
    expect(more).not.toBeNull();

    await act(async () => more?.click());
    expect(host.querySelectorAll('.chat-page-rail-item')).toHaveLength(15);

    more = host.querySelector<HTMLButtonElement>('.chat-page-rail-more');
    await act(async () => more?.click());
    expect(host.querySelectorAll('.chat-page-rail-item')).toHaveLength(10);
  });

  it('keeps an older current session visible in a limited folder preview', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const manySessions = Array.from({ length: 15 }, (_, index): UnifiedSession => ({
      sessionId: `session-${index}`,
      workspaceId: 'workspace-a',
      workspaceName: 'Workspace A',
      date: `2026-07-${String(30 - index).padStart(2, '0')}`,
      messageCount: 1,
      preview: `Conversation ${index + 1}`,
      isCurrent: index === 14,
    }));

    await act(async () => {
      root?.render(
        <I18nProvider>
          <ChatSessionsRail
            allSessions={manySessions}
            onNewSession={vi.fn()}
            onSelectSession={vi.fn()}
          />
        </I18nProvider>,
      );
    });

    expect(host.querySelectorAll('.chat-page-rail-item')).toHaveLength(10);
    expect(host.querySelector('.chat-page-rail-item--active')?.textContent).toContain('Conversation 15');
  });

  it('keeps global sessions visible and collapses workspace folders when global chat is active', async () => {
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
    expect(folders[0].getAttribute('aria-expanded')).toBe('false');
    expect(folders[1].getAttribute('aria-expanded')).toBe('false');
    expect(host.textContent).toContain('Global conversation');
    expect(host.textContent).not.toContain('First conversation');
  });

  it('labels the session tree, exposes the current chat, and filters locally', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <I18nProvider>
          <ChatSessionsRail
            allSessions={sessions.map((session) => ({
              ...session,
              isCurrent: session.sessionId === 'session-b',
            }))}
            onNewSession={vi.fn()}
            onSelectSession={vi.fn()}
          />
        </I18nProvider>,
      );
    });

    expect(host.querySelector('aside')?.getAttribute('aria-label')).toBe('Chat sessions');
    expect(host.querySelector('.chat-page-rail-item--active')?.getAttribute('aria-current')).toBe('page');
    for (const folder of host.querySelectorAll<HTMLButtonElement>('.chat-page-rail-folder')) {
      const listId = folder.getAttribute('aria-controls');
      expect(listId).toBeTruthy();
      expect(host.querySelector(`#${CSS.escape(listId!)}`)).not.toBeNull();
    }

    const search = host.querySelector<HTMLInputElement>('input[type="search"]');
    expect(search?.getAttribute('aria-label')).toBe('Search chats');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, 'third');
      search!.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });

    expect(host.textContent).toContain('Third conversation');
    expect(host.textContent).not.toContain('First conversation');
    expect(host.textContent).not.toContain('Second conversation');
  });

  it('offers pin, rename, and confirmed delete only when callbacks are provided', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const onTogglePinSession = vi.fn(async () => undefined);
    const onRenameSession = vi.fn(async () => undefined);
    const onDeleteSession = vi.fn(async () => undefined);

    await act(async () => {
      root?.render(
        <I18nProvider>
          <ChatSessionsRail
            allSessions={[sessions[0]]}
            onNewSession={vi.fn()}
            onSelectSession={vi.fn()}
            onTogglePinSession={onTogglePinSession}
            onRenameSession={onRenameSession}
            onDeleteSession={onDeleteSession}
          />
        </I18nProvider>,
      );
    });
    const testHost = host;
    if (!testHost) throw new Error('Expected rail host');

    const pin = testHost.querySelector<HTMLButtonElement>('[aria-label="Pin First conversation"]');
    const rename = testHost.querySelector<HTMLButtonElement>('[aria-label="Rename First conversation"]');
    const remove = testHost.querySelector<HTMLButtonElement>('[aria-label="Delete First conversation"]');
    expect(pin).not.toBeNull();
    expect(rename).not.toBeNull();
    expect(remove).not.toBeNull();

    await act(async () => {
      pin?.click();
      await Promise.resolve();
    });
    expect(onTogglePinSession).toHaveBeenCalledWith(sessions[0]);

    await act(async () => {
      rename?.click();
    });
    const renameInput = testHost.querySelector<HTMLInputElement>('[aria-label="Rename First conversation"]');
    expect(renameInput).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(renameInput, 'Decision log');
      renameInput?.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    await act(async () => {
      testHost.querySelector<HTMLButtonElement>('[aria-label="Save rename"]')?.click();
      await Promise.resolve();
    });
    expect(onRenameSession).toHaveBeenCalledWith(sessions[0], 'Decision log');

    await act(async () => {
      testHost.querySelector<HTMLButtonElement>('[aria-label="Delete First conversation"]')?.click();
    });
    expect(onDeleteSession).not.toHaveBeenCalled();
    await act(async () => {
      testHost.querySelector<HTMLButtonElement>('[aria-label="Confirm delete First conversation"]')?.click();
      await Promise.resolve();
    });
    expect(onDeleteSession).toHaveBeenCalledWith(sessions[0]);

    await act(async () => {
      root?.render(
        <I18nProvider>
          <ChatSessionsRail
            allSessions={[sessions[0]]}
            onNewSession={vi.fn()}
            onSelectSession={vi.fn()}
          />
        </I18nProvider>,
      );
    });
    expect(testHost.querySelector('.chat-page-rail-item-actions')).toBeNull();
  });

  it('keeps session rail readable while preventing session changes during generation', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const onNewSession = vi.fn();
    const onSelectSession = vi.fn();

    await act(async () => {
      root?.render(
        <I18nProvider>
          <ChatSessionsRail
            allSessions={sessions}
            disabled
            onNewSession={onNewSession}
            onSelectSession={onSelectSession}
          />
        </I18nProvider>,
      );
    });

    const rail = host.querySelector<HTMLElement>('.chat-page-rail');
    const newSession = host.querySelector<HTMLButtonElement>('.chat-page-rail-new');
    const search = host.querySelector<HTMLInputElement>('.chat-page-rail-search');
    const folders = Array.from(host.querySelectorAll<HTMLButtonElement>('.chat-page-rail-folder'));
    const firstSession = host.querySelector<HTMLButtonElement>('.chat-page-rail-item');

    expect(rail?.getAttribute('aria-busy')).toBe('true');
    expect(rail?.classList.contains('chat-page-rail--interaction-paused')).toBe(true);
    expect(newSession?.disabled).toBe(false);
    expect(newSession?.getAttribute('aria-disabled')).toBe('true');
    expect(search?.disabled).toBe(false);
    expect(folders[0].disabled).toBe(false);
    expect(firstSession?.disabled).toBe(false);
    expect(firstSession?.getAttribute('aria-disabled')).toBe('true');

    await act(async () => {
      newSession?.click();
      firstSession?.click();
      folders[1].click();
    });

    expect(onNewSession).not.toHaveBeenCalled();
    expect(onSelectSession).not.toHaveBeenCalled();
    expect(folders[1].getAttribute('aria-expanded')).toBe('true');
    expect(host.textContent).toContain('Third conversation');
  });

  it('keeps the list visible and marks the selected conversation busy while it opens', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <I18nProvider>
          <ChatSessionsRail
            allSessions={sessions.map((session) => ({
              ...session,
              isCurrent: session.sessionId === 'session-a',
            }))}
            pendingSessionKey="workspace-a:session-a"
            onNewSession={vi.fn()}
            onSelectSession={vi.fn()}
          />
        </I18nProvider>,
      );
    });

    expect(host.querySelector('.chat-page-rail')?.getAttribute('aria-busy')).toBe('true');
    expect(host.querySelector('.chat-page-rail-item--active')?.getAttribute('aria-busy')).toBe('true');
    expect(host.querySelector('.chat-page-rail-item--active .chat-spin')).toBeNull();
    expect(host.querySelector<HTMLButtonElement>('.chat-page-rail-folder')?.disabled).toBe(false);
    expect(host.querySelector<HTMLButtonElement>('.chat-page-rail-item')?.disabled).toBe(false);
    expect(host.textContent).toContain('Second conversation');
  });

  it('can pause draft creation without blocking history navigation', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const onNewSession = vi.fn();
    const onSelectSession = vi.fn();

    await act(async () => {
      root?.render(
        <I18nProvider>
          <ChatSessionsRail
            allSessions={[sessions[0]]}
            newSessionDisabled
            onNewSession={onNewSession}
            onSelectSession={onSelectSession}
          />
        </I18nProvider>,
      );
    });

    const newSession = host.querySelector<HTMLButtonElement>('.chat-page-rail-new');
    const existingSession = host.querySelector<HTMLButtonElement>('.chat-page-rail-item');
    await act(async () => {
      newSession?.click();
      existingSession?.click();
    });

    expect(newSession?.getAttribute('aria-disabled')).toBe('true');
    expect(onNewSession).not.toHaveBeenCalled();
    expect(onSelectSession).toHaveBeenCalledWith(sessions[0]);
  });
});
