// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { ChatTargetProvider, useChatTargetBroker, type ChatTargetBroker } from '../../../modules/chat';
import type { CanvasNode } from '../../../types';
import { Launcher } from '.';
import { HomeRouteView } from '../routes/HomeRouteView';
import { PulseRouter } from '../router';

const notify = vi.fn();
vi.mock('../../../shared/appShell', () => ({
  useAppShell: () => ({ notify }),
}));
// The `@` popup also lists roles, apps and plugins; keep it to workspaces.
vi.mock('../../../modules/chat/mentions/roleMentionItems', async (importOriginal) => ({
  ...await importOriginal<object>(),
  loadRoleMentionItems: async () => [],
}));
vi.mock('../../../modules/chat/mentions/appMentionItems', async (importOriginal) => ({
  ...await importOriginal<object>(),
  loadAppMentionItems: async () => [],
}));
vi.mock('../../../modules/chat/mentions/pluginMentionItems', async (importOriginal) => ({
  ...await importOriginal<object>(),
  loadInstalledPluginMentionItems: async () => [],
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let broker: ChatTargetBroker;

const BrokerProbe = () => {
  broker = useChatTargetBroker();
  return null;
};

const loadedNodes = {
  a: [],
  b: [
    { id: 'n1', type: 'text', x: 0, y: 0, width: 200, height: 120 },
    { id: 'n2', type: 'text', x: 240, y: 0, width: 200, height: 120 },
  ],
} as unknown as Record<string, CanvasNode[]>;

const props = {
  workspaces: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }, { id: 'c', name: 'Gamma' }],
  folders: [{ id: 'f1', name: 'Clients' }],
  loadedNodes,
  onOpenModelSettings: vi.fn(),
  onEnterChat: vi.fn(),
  onOpenSession: vi.fn(),
  onOpenAllChats: vi.fn(),
  onOpenWorkspace: vi.fn(),
  onCreateWorkspace: vi.fn(),
  onOpenAllWorkspaces: vi.fn(),
  onWorkspaceContextRequest: vi.fn(),
};

const render = async (active = true) => {
  await act(async () => root.render(
    <I18nProvider>
      <ChatTargetProvider>
        <BrokerProbe />
        <Launcher {...props} active={active} />
      </ChatTargetProvider>
    </I18nProvider>,
  ));
  // Let the store and session reads resolve.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
};

const field = () => host.querySelector<HTMLDivElement>('.launcher__ask-input')!;

/** Types into the contentEditable field with the caret at the end. */
const typeQuestion = async (value: string) => {
  const input = field();
  await act(async () => {
    input.textContent = value;
    const range = document.createRange();
    range.setStart(input.firstChild!, value.length);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return input;
};

const pressEnter = (input: HTMLElement) => {
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem('pulse-canvas.language', 'en');
  window.localStorage.setItem('pulse-canvas.recent-workspaces', JSON.stringify(['b', 'a']));
  (window as any).canvasWorkspace = {
    store: {
      load: vi.fn(),
      summaries: vi.fn(async (ids: string[]) => ({
        ok: true,
        summaries: Object.fromEntries(ids.map((id) => [id, {
          nodeCount: 3,
          boxes: [{ type: 'file', title: 'Pricing notes', x: 0, y: 0, width: 100, height: 80 }],
        }])),
      })),
    },
    model: { status: vi.fn(async () => ({ ok: true, status: { apiKeyPresent: true } })) },
    agent: {
      newSession: vi.fn(async () => ({ ok: true, activeSessionId: 'fresh' })),
      getScopeRunningSessions: vi.fn(async ({ scope }: { scope: { kind: string; workspaceId?: string } }) => ({
        ok: true,
        conversationSessionIds: scope.workspaceId === 'b' ? ['s2'] : [],
      })),
      listAllSessions: vi.fn(async () => ({
        ok: true,
        groups: [
          {
            workspaceId: '__global_chat__',
            workspaceName: '',
            sessions: [{ sessionId: 's1', date: '', updatedAt: 10, messageCount: 2, isCurrent: false, title: 'Older chat' }],
          },
          {
            workspaceId: 'b',
            workspaceName: 'Beta',
            sessions: [
              { sessionId: 's2', date: '', updatedAt: 20, messageCount: 4, isCurrent: true, preview: 'Newest chat' },
              { sessionId: 's3', date: '', updatedAt: 30, messageCount: 0, isCurrent: false },
            ],
          },
        ],
      })),
    },
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('Launcher', () => {
  it('lists workspaces most recently opened first, with previews from memory or stored layouts', async () => {
    await render();
    const cards = [...host.querySelectorAll<HTMLButtonElement>('.launcher__card')];
    expect(cards.map((card) => card.querySelector('.launcher__card-name')?.textContent))
      .toEqual(['Beta', 'Alpha', 'Gamma', 'New workspace']);
    expect(cards[0].querySelector('.launcher__card-meta')?.textContent).toBe('2 cards');
    expect(cards[0].querySelectorAll('.launcher__thumb-card')).toHaveLength(2);
    expect(cards[1].querySelector('.launcher__card-meta')?.textContent).toBe('Empty workspace');
    // Gamma is not loaded in this window: it comes from a stored-layout
    // summary, never from a full canvas load.
    expect(cards[2].querySelector('.launcher__card-meta')?.textContent).toBe('3 cards');
    const stored = cards[2].querySelectorAll<HTMLElement>('.launcher__thumb-card');
    expect(stored).toHaveLength(1);
    expect(stored[0].dataset.type).toBe('file');
    expect(stored[0].querySelector('.launcher__thumb-title')?.textContent).toBe('Pricing notes');
    expect((window as any).canvasWorkspace.store.summaries).toHaveBeenCalledWith(['c']);
    expect((window as any).canvasWorkspace.store.load).not.toHaveBeenCalled();

    await act(async () => cards[0].click());
    expect(props.onOpenWorkspace).toHaveBeenCalledWith('b');
  });

  it('reloads recent chats each time the kept-alive launcher is shown again', async () => {
    await render();
    const listAllSessions = (window as any).canvasWorkspace.agent.listAllSessions;
    expect(listAllSessions).toHaveBeenCalledTimes(1);

    await render(false);
    expect(listAllSessions).toHaveBeenCalledTimes(1);
    listAllSessions.mockResolvedValueOnce({
      ok: true,
      groups: [{
        workspaceId: 'a',
        workspaceName: 'Alpha',
        sessions: [{ sessionId: 's9', date: '', updatedAt: 99, messageCount: 1, isCurrent: true, title: 'Fresh chat' }],
      }],
    });
    await render(true);
    expect(listAllSessions).toHaveBeenCalledTimes(2);
    expect(host.querySelector('.launcher__chat-title')?.textContent).toBe('Fresh chat');
  });

  it('marks recent chats whose reply is still running', async () => {
    await render();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const rows = [...host.querySelectorAll<HTMLButtonElement>('.launcher__chat')];
    const running = rows.filter((row) => row.querySelector('.launcher__chat-running'));
    expect(running.map((row) => row.querySelector('.launcher__chat-title')?.textContent)).toEqual(['Newest chat']);
    expect(running[0].querySelector('.launcher__chat-running')?.textContent).toBe('Running');
  });

  it('names a new workspace and picks its folder in a dialog', async () => {
    await render();
    await act(async () => host.querySelector<HTMLButtonElement>('.launcher__card--new')!.click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const input = dialog.querySelector<HTMLInputElement>('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Roadmap');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => dialog.querySelector<HTMLButtonElement>('.ui-select__trigger')!.click());
    await act(async () => [...dialog.querySelectorAll<HTMLButtonElement>('.ui-select__option')]
      .find((option) => option.textContent?.includes('Clients'))!.click());
    await act(async () => dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
    expect(props.onCreateWorkspace).toHaveBeenCalledWith('Roadmap', 'f1');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('opens the full workspace list from View all', async () => {
    await render();
    const section = host.querySelector<HTMLElement>('[aria-labelledby="launcher-workspaces"]')!;
    await act(async () => section.querySelector<HTMLButtonElement>('.launcher__view-all')!.click());
    expect(props.onOpenAllWorkspaces).toHaveBeenCalledTimes(1);
  });

  it('shows recent non-empty chats across scopes and reopens one in its scope', async () => {
    await render();
    const rows = [...host.querySelectorAll<HTMLButtonElement>('.launcher__chat')];
    expect(rows.map((row) => row.querySelector('.launcher__chat-title')?.textContent))
      .toEqual(['Newest chat', 'Older chat']);
    expect(rows[1].querySelector('.launcher__chat-meta')?.textContent).toMatch(/^All workspaces/);

    await act(async () => rows[0].click());
    expect(props.onOpenSession).toHaveBeenCalledWith({ kind: 'workspace', workspaceId: 'b' }, 's2', 'Beta');

    await act(async () => host.querySelector<HTMLButtonElement>('.launcher__section--chats .launcher__view-all')!.click());
    expect(props.onOpenAllChats).toHaveBeenCalledTimes(1);
  });

  it('fills the composer from a starter', async () => {
    await render();
    await act(async () => host.querySelector<HTMLButtonElement>('.launcher__starter')!.click());
    expect(field().textContent).toBe('Summarize this week across my workspaces');
  });

  it('opens the chat page on a new session and sends once its composer registers', async () => {
    await render();
    const input = await typeQuestion('  plan my week  ');
    const submitPrompt = vi.fn().mockResolvedValue(true);
    props.onEnterChat.mockImplementation((target) => {
      // The page registers a moment after navigation, like the lazy chat page.
      setTimeout(() => broker.register(target, { submitPrompt }), 150);
    });

    await act(async () => {
      pressEnter(input);
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    expect(window.canvasWorkspace.agent.newSession).toHaveBeenCalledWith({ scope: { kind: 'global' } });
    expect(props.onEnterChat).toHaveBeenCalledWith(expect.objectContaining({
      surface: 'page',
      scope: { kind: 'global' },
      sessionId: 'fresh',
      composerId: 'page:__global_chat__',
    }));
    expect(submitPrompt).toHaveBeenCalledWith({ text: 'plan my week', nodes: [] });
    expect(input.textContent).toBe('');
    expect(notify).not.toHaveBeenCalled();
  });

  it('stays on the launcher with the question when the new session fails', async () => {
    vi.mocked(window.canvasWorkspace.agent.newSession).mockResolvedValueOnce({ ok: false, error: 'disk full' });
    await render();
    const input = await typeQuestion('plan my week');

    await act(async () => pressEnter(input));

    expect(props.onEnterChat).not.toHaveBeenCalled();
    expect(input.textContent).toBe('plan my week');
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error', description: 'disk full' }));
  });

  it('mentions a workspace with @ and sends it as the turn context', async () => {
    await render();
    const input = await typeQuestion('compare @Be');
    const options = [...host.querySelectorAll('.chat-mention-popup [role="option"]')];
    expect(options.map((option) => option.textContent)).toEqual([expect.stringContaining('Beta')]);

    await act(async () => pressEnter(input));
    expect(host.querySelector('.chat-mention-popup')).toBeNull();
    expect(input.querySelector('.chat-mention-chip')?.textContent).toContain('Beta');

    const submitPrompt = vi.fn().mockResolvedValue(true);
    props.onEnterChat.mockImplementation((target) => broker.register(target, { submitPrompt }));
    await act(async () => {
      pressEnter(input);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(submitPrompt).toHaveBeenCalledWith(expect.objectContaining({
      text: 'compare @[canvas:Beta]',
      context: expect.objectContaining({ canvases: [{ id: 'b', name: 'Beta' }] }),
    }));
  });

  it('mentions cards from every workspace in the global scope', async () => {
    (window as any).canvasWorkspace.workspaceNodes = {
      list: vi.fn(async (workspaceId: string) => ({
        ok: true,
        nodes: workspaceId === 'b'
          ? [{ id: 'n1', type: 'text', title: 'Pricing notes', tags: [], hasData: true, linkCount: 0 }]
          : [],
      })),
    };
    await render();
    await typeQuestion('see @Pricing');
    const options = [...host.querySelectorAll('.chat-mention-popup [role="option"]')];
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringMatching(/Pricing notes.*Beta/),
    ]);
  });

  it('submits only once when Enter is pressed twice before React commits', async () => {
    await render();
    const input = await typeQuestion('one question');
    const submitPrompt = vi.fn().mockResolvedValue(true);
    props.onEnterChat.mockImplementation((target) => broker.register(target, { submitPrompt }));
    await act(async () => {
      pressEnter(input);
      pressEnter(input);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(window.canvasWorkspace.agent.newSession).toHaveBeenCalledTimes(1);
    expect(submitPrompt).toHaveBeenCalledTimes(1);
  });

  it('checks model setup before creating a session or navigating away', async () => {
    vi.mocked(window.canvasWorkspace.model.status).mockResolvedValueOnce({ ok: true, status: { apiKeyPresent: false } } as any);
    await render();
    const input = await typeQuestion('keep this question');
    await act(async () => pressEnter(input));
    expect(props.onOpenModelSettings).toHaveBeenCalledTimes(1);
    expect(window.canvasWorkspace.agent.newSession).not.toHaveBeenCalled();
    expect(props.onEnterChat).not.toHaveBeenCalled();
    expect(input.textContent).toBe('keep this question');
  });

  it('does not retry a rejected submission or clear its draft', async () => {
    await render();
    const input = await typeQuestion('retain on failure');
    const submitPrompt = vi.fn().mockResolvedValue(false);
    props.onEnterChat.mockImplementation((target) => broker.register(target, { submitPrompt }));
    await act(async () => {
      pressEnter(input);
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(submitPrompt).toHaveBeenCalledTimes(1);
    expect(input.textContent).toBe('retain on failure');
  });

  it('retains text, mention chips and scope when settings unmounts the active route', async () => {
    const renderRoute = async (active: boolean) => {
      await act(async () => root.render(
        <I18nProvider><ChatTargetProvider>
          <PulseRouter activeKey={active ? 'home' : 'settings'}>
            <HomeRouteView {...props} active={active} />
          </PulseRouter>
        </ChatTargetProvider></I18nProvider>,
      ));
    };
    await renderRoute(true);
    await typeQuestion('compare @Be');
    await act(async () => pressEnter(field()));
    await act(async () => host.querySelector<HTMLButtonElement>('.launcher__scope .ui-select__trigger')!.click());
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>('.ui-select__option')]
      .find((option) => option.textContent?.includes('Beta'))!.click());
    await renderRoute(false);
    await renderRoute(true);
    expect(field().textContent).toContain('compare');
    expect(field().querySelector('.chat-mention-chip')?.textContent).toContain('Beta');
    expect(host.querySelector('.launcher__scope')?.textContent).toContain('Beta');
    expect(window.canvasWorkspace.agent.newSession).not.toHaveBeenCalled();
  });

  it('loads a workspace for its card mentions only once it is the picked scope', async () => {
    await render();
    expect(props.onWorkspaceContextRequest).not.toHaveBeenCalled();

    await act(async () => host.querySelector<HTMLButtonElement>('.launcher__scope .ui-select__trigger')!.click());
    const beta = [...host.querySelectorAll<HTMLButtonElement>('.ui-select__option')]
      .find((option) => option.textContent?.includes('Beta'))!;
    await act(async () => beta.click());

    expect(props.onWorkspaceContextRequest).toHaveBeenCalledWith('b');
    expect((window as any).canvasWorkspace.store.load).not.toHaveBeenCalled();
  });
});
