// @vitest-environment happy-dom
import { act, createRef, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../i18n';
import type { AgentChatMessage } from '../../../../../types';
import { countLaterMessages } from '../../../runtime/useConversationRecovery';
import { ChatView } from '..';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const baseProps = {
  chrome: {},
  thread: {
    messages: [], loading: false, workspaceId: 'workspace-1', streamingTools: [],
    messageTools: new Map(), collapsedSections: new Set<number>(), expandedTools: new Set<number>(),
    pendingClarify: null, clarifyInput: '', onClarifyInputChange: vi.fn(),
    onAnswerClarification: vi.fn(async () => undefined), onToggleSection: vi.fn(),
    onToggleToolExpand: vi.fn(),
  },
  context: { onQuickAction: vi.fn() },
  composer: {
    input: '', editableRef: createRef<HTMLDivElement>(), mentionOpen: false, mentionItems: [], mentionIndex: 0,
    onSelectMention: vi.fn(), onMentionIndexChange: vi.fn(), onInput: vi.fn(),
    onKeyDown: vi.fn(), onPaste: vi.fn(), onSubmit: vi.fn(async () => true),
    onAbort: vi.fn(async () => true),
  },
} satisfies ComponentProps<typeof ChatView>;

const thread: AgentChatMessage[] = [
  { role: 'user', content: 'First question', timestamp: 1 },
  {
    role: 'assistant',
    content: '',
    timestamp: 2,
    turnStatus: 'failed',
    failureKind: 'unknown',
    retryable: true,
  },
  { role: 'user', content: 'Second question', timestamp: 3 },
  { role: 'assistant', content: 'Second answer', timestamp: 4 },
  { role: 'user', content: 'Third question', timestamp: 5 },
  { role: 'assistant', content: 'Third answer', timestamp: 6 },
];

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

const renderChat = async (threadOverrides: Partial<ComponentProps<typeof ChatView>['thread']>) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <I18nProvider>
        <ChatView {...baseProps} thread={{ ...baseProps.thread, ...threadOverrides, messages: thread }} />
      </I18nProvider>,
    );
  });
  return host;
};

const buttons = (view: HTMLElement, text: string) => Array.from(view.querySelectorAll<HTMLButtonElement>('button'))
  .filter(button => button.textContent === text);

describe('countLaterMessages', () => {
  it('counts the messages after the turn a row belongs to', () => {
    expect(countLaterMessages(thread, 0)).toBe(4);
    expect(countLaterMessages(thread, 1)).toBe(4);
    expect(countLaterMessages(thread, 3)).toBe(2);
    expect(countLaterMessages(thread, 4)).toBe(0);
    expect(countLaterMessages(thread, 5)).toBe(0);
  });
});

describe('ChatView history truncation', () => {
  it('asks before an older retry removes later messages', async () => {
    const onRegenerate = vi.fn(async () => true);
    const view = await renderChat({ onRegenerate });

    await act(async () => buttons(view, 'Try again')[0]?.click());

    expect(onRegenerate).not.toHaveBeenCalled();
    expect(view.textContent).toContain('Regenerating removes the 4 later messages in this chat.');

    await act(async () => buttons(view, 'Cancel')[0]?.click());
    expect(view.textContent).not.toContain('later messages in this chat');
    expect(onRegenerate).not.toHaveBeenCalled();

    await act(async () => buttons(view, 'Try again')[0]?.click());
    await act(async () => buttons(view, 'Remove and regenerate')[0]?.click());
    expect(onRegenerate).toHaveBeenCalledWith(1);
  });

  it('offers a fork instead of removing later messages', async () => {
    const onRegenerate = vi.fn(async () => true);
    const onFork = vi.fn(async () => true);
    const view = await renderChat({ onRegenerate, onFork });
    const regenerate = view.querySelectorAll<HTMLButtonElement>('[aria-label="Regenerate response"]')[0];

    await act(async () => regenerate?.click());
    await act(async () => buttons(view, 'Fork instead')[0]?.click());

    expect(onFork).toHaveBeenCalledWith(3);
    expect(onRegenerate).not.toHaveBeenCalled();
  });

  it('regenerates the latest turn without asking', async () => {
    const onRegenerate = vi.fn(async () => true);
    const view = await renderChat({ onRegenerate });
    const regenerateButtons = view.querySelectorAll<HTMLButtonElement>('[aria-label="Regenerate response"]');

    await act(async () => regenerateButtons[regenerateButtons.length - 1]?.click());

    expect(onRegenerate).toHaveBeenCalledWith(5);
  });

  it('warns while editing an older message', async () => {
    const onEditUserMessage = vi.fn(async () => true);
    const view = await renderChat({ onEditUserMessage });
    const edit = view.querySelectorAll<HTMLButtonElement>('[aria-label="Edit and resend"]')[1];

    await act(async () => edit?.click());

    expect(view.textContent).toContain('Resending removes the 2 later messages in this chat.');
    await act(async () => buttons(view, 'Save & remove later messages')[0]?.click());
    expect(onEditUserMessage).toHaveBeenCalledWith(2, 'Second question');
  });
});

describe('ChatView interrupted turns', () => {
  const renderMessages = async (
    messages: AgentChatMessage[],
    threadOverrides: Partial<ComponentProps<typeof ChatView>['thread']> = {},
  ) => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <I18nProvider>
          <ChatView {...baseProps} thread={{ ...baseProps.thread, ...threadOverrides, messages }} />
        </I18nProvider>,
      );
    });
    return host;
  };

  it('offers a retry when the thread ends without a reply', async () => {
    const onRegenerate = vi.fn(async () => true);
    const view = await renderMessages([
      { role: 'user', content: 'First question', timestamp: 1 },
      { role: 'assistant', content: 'First answer', timestamp: 2 },
      { role: 'user', content: 'Lost question', timestamp: 3 },
    ], { onRegenerate });

    expect(view.textContent).toContain('Response interrupted');
    expect(view.textContent).toContain('This reply was interrupted before it finished.');
    await act(async () => buttons(view, 'Try again')[0]?.click());
    expect(onRegenerate).toHaveBeenCalledWith(2);
  });

  it('does not mark a running turn as interrupted', async () => {
    const view = await renderMessages([
      { role: 'user', content: 'Running question', timestamp: 1 },
    ], { loading: true, onRegenerate: vi.fn() });

    expect(view.textContent).not.toContain('interrupted');
  });

  it('describes a checkpointed partial reply as interrupted', async () => {
    const view = await renderMessages([
      { role: 'user', content: 'Question', timestamp: 1 },
      {
        role: 'assistant',
        content: 'Half an answer',
        timestamp: 2,
        turnStatus: 'failed',
        failureKind: 'interrupted',
        retryable: true,
      },
    ], { onRegenerate: vi.fn() });

    expect(view.textContent).toContain('Half an answer');
    expect(view.textContent).toContain('This reply was interrupted before it finished.');
    expect(buttons(view, 'Try again')).toHaveLength(1);
  });
});
