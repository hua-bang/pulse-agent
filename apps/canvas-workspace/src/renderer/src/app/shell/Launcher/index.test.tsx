// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { ChatTargetProvider, useChatTargetBroker, type ChatTargetBroker } from '../../../modules/chat';
import type { CanvasNode } from '../../../types';
import { Launcher } from '.';

const notify = vi.fn();
vi.mock('../../../shared/appShell', () => ({
  useAppShell: () => ({ notify }),
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
  loadedNodes,
  onEnterChat: vi.fn(),
  onOpenSession: vi.fn(),
  onOpenAllChats: vi.fn(),
  onOpenWorkspace: vi.fn(),
  onCreateWorkspace: vi.fn(),
};

const render = async () => {
  await act(async () => root.render(
    <I18nProvider>
      <ChatTargetProvider>
        <BrokerProbe />
        <Launcher {...props} />
      </ChatTargetProvider>
    </I18nProvider>,
  ));
  // Let the store and session reads resolve.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
};

const typeQuestion = async (value: string) => {
  const input = host.querySelector<HTMLTextAreaElement>('.launcher__ask-input')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
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
    agent: {
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
    await act(async () => cards[3].click());
    expect(props.onOpenWorkspace).toHaveBeenCalledWith('b');
    expect(props.onCreateWorkspace).toHaveBeenCalledTimes(1);
  });

  it('shows recent non-empty chats across scopes and reopens one in its scope', async () => {
    await render();
    const rows = [...host.querySelectorAll<HTMLButtonElement>('.launcher__chat')];
    expect(rows.map((row) => row.querySelector('.launcher__chat-title')?.textContent))
      .toEqual(['Newest chat', 'Older chat']);
    expect(rows[1].querySelector('.launcher__chat-meta')?.textContent).toMatch(/^General/);

    await act(async () => rows[0].click());
    expect(props.onOpenSession).toHaveBeenCalledWith({ kind: 'workspace', workspaceId: 'b' }, 's2', 'Beta');

    await act(async () => host.querySelector<HTMLButtonElement>('.launcher__view-all')!.click());
    expect(props.onOpenAllChats).toHaveBeenCalledTimes(1);
  });

  it('fills the composer from a starter', async () => {
    await render();
    await act(async () => host.querySelector<HTMLButtonElement>('.launcher__starter')!.click());
    expect(host.querySelector<HTMLTextAreaElement>('.launcher__ask-input')!.value).toBe('Plan a product launch');
  });

  it('enters the global chat page on Enter and sends once its composer registers', async () => {
    await render();
    const input = await typeQuestion('  plan my week  ');
    const submitPrompt = vi.fn().mockResolvedValue(true);
    props.onEnterChat.mockImplementation((target) => {
      // The page registers a moment after navigation, like the lazy chat page.
      setTimeout(() => broker.register(target, { submitPrompt }), 150);
    });

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    expect(props.onEnterChat).toHaveBeenCalledWith(expect.objectContaining({
      surface: 'page',
      scope: { kind: 'global' },
      sessionId: null,
      composerId: 'page:__global_chat__',
    }));
    expect(submitPrompt).toHaveBeenCalledWith({ text: 'plan my week', nodes: [], newSession: true });
    expect(input.value).toBe('');
    expect(notify).not.toHaveBeenCalled();
  });
});
