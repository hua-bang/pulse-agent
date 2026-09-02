// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n';
import type { AgentContextTabRef } from '../../../../types';
import { resetChatComposerDraftsForTests } from '../../../../agent-chat/composer/chatComposerDraftStore';
import { useChatComposerInput } from '../useChatComposerInput';
import { resetPluginMentionItemsForTests } from '../../../../agent-chat/mentions/pluginMentionItems';

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

const renderHook = async () => {
  Object.defineProperty(window, 'canvasWorkspace', {
    configurable: true,
    value: {
      agentRoles: { list: vi.fn(async () => ({ ok: true, roles: [] })) },
      pluginMarket: {
        list: vi.fn(async () => ({
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
        })),
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
});
