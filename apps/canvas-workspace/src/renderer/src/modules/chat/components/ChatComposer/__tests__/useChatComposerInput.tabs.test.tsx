// @vitest-environment happy-dom
import { act, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../i18n';
import type { AgentContextTabRef } from '../../../../../types';
import { resetChatComposerDraftsForTests } from '../../../composer/chatComposerDraftStore';
import { useChatComposerInput } from '../useChatComposerInput';
import { resetPluginMentionItemsForTests } from '../../../mentions/pluginMentionItems';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Hook = ReturnType<typeof useChatComposerInput>;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let latest: Hook | null = null;
const onSubmit = vi.fn(async () => true);

const dockTab: AgentContextTabRef = {
  id: 'canvas:workspace-product',
  kind: 'canvas',
  title: 'Roadmap',
  workspaceId: 'workspace-product',
  dockWorkspaceId: 'workspace-live',
  isActive: true,
  isVisible: true,
};

const Probe = () => {
  latest = useChatComposerInput({
    agentScope: { kind: 'global' },
    allWorkspaces: [
      { id: 'workspace-product', name: 'Product' },
      { id: 'workspace-live', name: 'Current workspace' },
    ],
    dockTabs: [dockTab],
    onSubmit,
  });
  return <div ref={latest.editableRef} contentEditable />;
};

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  latest = null;
  resetChatComposerDraftsForTests();
  resetPluginMentionItemsForTests();
  onSubmit.mockClear();
  vi.restoreAllMocks();
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const setMentionQuery = async (query: string) => {
  const editable = latest?.editableRef.current;
  if (!editable) throw new Error('composer did not mount');
  editable.textContent = `@${query}`;
  const textNode = editable.firstChild;
  if (!textNode) throw new Error('composer query did not mount');
  const range = document.createRange();
  range.setStart(textNode, query.length + 1);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  act(() => latest?.handleInput());
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const sessionResult = (query: string) => ({
  ok: true,
  hits: [{
    sessionId: `session-${query}`,
    workspaceId: 'workspace-product',
    workspaceName: 'Product',
    preview: `${query} result`,
    date: '2026-09-12',
  }],
});

const renderHook = async (overrides: {
  pluginList?: () => Promise<unknown>;
  searchSessions?: (query: string) => Promise<unknown>;
} = {}) => {
  Object.defineProperty(window, 'canvasWorkspace', {
    configurable: true,
    value: {
      agentRoles: { list: vi.fn(async () => ({ ok: true, roles: [] })) },
      agent: {
        searchSessions: vi.fn(overrides.searchSessions ?? (async () => ({ ok: true, hits: [] }))),
      },
      pluginMarket: {
        list: vi.fn(overrides.pluginList ?? (async () => ({
          ok: true,
          snapshot: {
            updatedAt: 1,
            listings: [{
              id: 'notion',
              name: 'Notion',
              description: 'Work with Notion pages',
              installState: 'installed',
            }],
          },
        }))),
      },
    },
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<I18nProvider><Probe /></I18nProvider>));
};

describe('global chat dock-tab mentions', () => {
  it('offers the current dock tab with disambiguation but never injects it implicitly', async () => {
    await renderHook();
    act(() => latest?.replaceInput('Summarize what I am looking at'));
    await act(async () => { await latest?.submitCurrentInput(); });

    expect(onSubmit).toHaveBeenCalledWith(
      'Summarize what I am looking at',
      undefined,
      [],
    );

    const editable = latest?.editableRef.current;
    if (!editable) throw new Error('composer did not mount');
    editable.textContent = '@';
    const textNode = editable.firstChild;
    if (!textNode) throw new Error('composer text node did not mount');
    const range = document.createRange();
    range.setStart(textNode, 1);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    await act(async () => {
      latest?.handleInput();
      await Promise.resolve();
    });

    const tabItem = latest?.mentionItems.find(item => item.type === 'tab');
    expect(tabItem).toMatchObject({
      label: 'Roadmap',
      description: 'Canvas · Product · Current tab',
      tab: dockTab,
    });
    expect(latest?.mentionItems.find(item => item.type === 'plugin')).toMatchObject({
      pluginId: 'notion',
      label: 'Notion',
      description: 'Work with Notion pages',
    });

    editable.textContent = '@Product';
    const workspaceQuery = editable.firstChild;
    if (!workspaceQuery) throw new Error('composer query did not mount');
    const queryRange = document.createRange();
    queryRange.setStart(workspaceQuery, '@Product'.length);
    queryRange.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(queryRange);
    await act(async () => {
      latest?.handleInput();
      await Promise.resolve();
    });
    expect(latest?.mentionItems.some(item => item.type === 'tab' && item.label === 'Roadmap'))
      .toBe(true);
  });

  it('shows loading before async results and settles loading separately from no results', async () => {
    const search = deferred<ReturnType<typeof sessionResult>>();
    await renderHook({ searchSessions: async () => search.promise });

    await setMentionQuery('CPA');

    expect(latest?.mentionOpen).toBe(true);
    expect(latest?.mentionLoading).toBe(true);
    expect(latest?.mentionItems).toEqual([]);

    await act(async () => search.resolve(sessionResult('CPA')));

    expect(latest?.mentionLoading).toBe(false);
    expect(latest?.mentionItems).toEqual([
      expect.objectContaining({
        type: 'session',
        sessionId: 'session-CPA',
        label: 'CPA result',
      }),
    ]);

    const emptySearch = deferred<{ ok: true; hits: [] }>();
    const searchSessions = window.canvasWorkspace.agent.searchSessions as ReturnType<typeof vi.fn>;
    searchSessions.mockImplementationOnce(async () => emptySearch.promise);
    await setMentionQuery('missing');

    expect(latest?.mentionOpen).toBe(true);
    expect(latest?.mentionLoading).toBe(true);
    expect(latest?.mentionItems).toEqual([]);

    await act(async () => emptySearch.resolve({ ok: true, hits: [] }));

    expect(latest?.mentionOpen).toBe(true);
    expect(latest?.mentionLoading).toBe(false);
    expect(latest?.mentionItems).toEqual([]);

    const preventDefault = vi.fn();
    await act(async () => {
      latest?.handleKeyDown({
        key: 'Enter',
        shiftKey: false,
        preventDefault,
      } as unknown as ReactKeyboardEvent<HTMLDivElement>);
      await Promise.resolve();
    });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith('@missing', undefined, []);
  });

  it('keeps newer loading and results authoritative across rapid query changes', async () => {
    const oldSearch = deferred<ReturnType<typeof sessionResult>>();
    const newSearch = deferred<ReturnType<typeof sessionResult>>();
    const searchSessions = vi.fn((query: string) => (
      query === 'old' ? oldSearch.promise : newSearch.promise
    ));
    await renderHook({ searchSessions });

    await setMentionQuery('old');
    expect(searchSessions).toHaveBeenCalledWith('old', 5);
    expect(latest?.mentionLoading).toBe(true);

    await setMentionQuery('new');
    expect(searchSessions).toHaveBeenCalledWith('new', 5);
    expect(latest?.mentionOpen).toBe(true);
    expect(latest?.mentionLoading).toBe(true);

    await act(async () => oldSearch.resolve(sessionResult('old')));
    expect(latest?.mentionOpen).toBe(true);
    expect(latest?.mentionLoading).toBe(true);
    expect(latest?.mentionItems).toEqual([]);

    await act(async () => newSearch.resolve(sessionResult('new')));
    expect(latest?.mentionLoading).toBe(false);
    expect(latest?.mentionItems).toEqual([
      expect.objectContaining({
        type: 'session',
        sessionId: 'session-new',
        label: 'new result',
      }),
    ]);
  });

  it('keeps a reopened query authoritative after closing a pending search', async () => {
    const oldSearch = deferred<ReturnType<typeof sessionResult>>();
    const newSearch = deferred<ReturnType<typeof sessionResult>>();
    const searchSessions = vi.fn((query: string) => (
      query === 'old' ? oldSearch.promise : newSearch.promise
    ));
    await renderHook({ searchSessions });

    await setMentionQuery('old');
    act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(latest?.mentionOpen).toBe(false);
    expect(latest?.mentionLoading).toBe(false);

    await setMentionQuery('new');
    expect(latest?.mentionOpen).toBe(true);
    expect(latest?.mentionLoading).toBe(true);

    await act(async () => oldSearch.resolve(sessionResult('old')));
    expect(latest?.mentionOpen).toBe(true);
    expect(latest?.mentionLoading).toBe(true);
    expect(latest?.mentionItems).toEqual([]);

    await act(async () => newSearch.resolve(sessionResult('new')));
    expect(latest?.mentionLoading).toBe(false);
    expect(latest?.mentionItems).toEqual([
      expect.objectContaining({
        type: 'session',
        sessionId: 'session-new',
      }),
    ]);
  });

  it('invalidates pending mention state when input is replaced programmatically', async () => {
    const search = deferred<ReturnType<typeof sessionResult>>();
    await renderHook({ searchSessions: async () => search.promise });
    await setMentionQuery('pending');

    act(() => latest?.replaceInput('replacement'));
    expect(latest?.mentionOpen).toBe(false);
    expect(latest?.mentionLoading).toBe(false);
    expect(latest?.mentionItems).toEqual([]);

    await act(async () => search.resolve(sessionResult('pending')));
    expect(latest?.mentionOpen).toBe(false);
    expect(latest?.mentionLoading).toBe(false);
    expect(latest?.mentionItems).toEqual([]);
  });

  it('closes and invalidates a pending mention search on Escape', async () => {
    const search = deferred<ReturnType<typeof sessionResult>>();
    await renderHook({ searchSessions: async () => search.promise });
    await setMentionQuery('pending');
    const preventDefault = vi.fn();

    act(() => latest?.handleKeyDown({
      key: 'Escape',
      preventDefault,
    } as unknown as ReactKeyboardEvent<HTMLDivElement>));

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(latest?.mentionOpen).toBe(false);
    expect(latest?.mentionLoading).toBe(false);

    await act(async () => search.resolve(sessionResult('pending')));
    expect(latest?.mentionOpen).toBe(false);
    expect(latest?.mentionLoading).toBe(false);
    expect(latest?.mentionItems).toEqual([]);
  });
});
