// @vitest-environment happy-dom
import { act, createRef, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../i18n';
import type { AgentChatMessage } from '../../../../../types';
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

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

const renderChat = async (
  messages: AgentChatMessage[],
  threadOverrides: Partial<ComponentProps<typeof ChatView>['thread']> = {},
) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const editableRef = createRef<HTMLDivElement>();
  await act(async () => {
    root?.render(
      <I18nProvider>
        <ChatView
          {...baseProps}
          thread={{ ...baseProps.thread, ...threadOverrides, messages }}
          composer={{ ...baseProps.composer, editableRef }}
        />
      </I18nProvider>,
    );
  });
  return { editableRef, host };
};

const flushFocusFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

describe('ChatView recovery focus', () => {
  it('returns focus to the composer after a failed-turn retry succeeds', async () => {
    const onRegenerate = vi.fn(async () => true);
    const view = await renderChat([{
      role: 'assistant',
      content: 'The AI service could not complete this reply.',
      timestamp: 1,
      turnStatus: 'failed',
      retryable: true,
    }], { onRegenerate });
    const retry = Array.from(view.host.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent === 'Try again');
    retry?.focus();

    await act(async () => {
      retry?.click();
      await Promise.resolve();
      await flushFocusFrame();
    });

    expect(onRegenerate).toHaveBeenCalledWith(0);
    expect(document.activeElement).toBe(view.editableRef.current);
  });

  it('returns focus to the composer after stopped-turn regeneration succeeds', async () => {
    const onRegenerate = vi.fn(async () => true);
    const view = await renderChat([{
      role: 'assistant',
      content: 'A partial response.',
      timestamp: 1,
      turnStatus: 'stopped',
      retryable: true,
    }], { onRegenerate });
    const regenerate = Array.from(view.host.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent === 'Regenerate');
    regenerate?.focus();

    await act(async () => {
      regenerate?.click();
      await Promise.resolve();
      await flushFocusFrame();
    });

    expect(document.activeElement).toBe(view.editableRef.current);
  });

  it('returns focus to the composer after ordinary regeneration succeeds', async () => {
    const onRegenerate = vi.fn(async () => true);
    const view = await renderChat([{
      role: 'assistant',
      content: 'A complete response.',
      timestamp: 1,
    }], { onRegenerate });
    const regenerate = view.host.querySelector<HTMLButtonElement>('[aria-label="Regenerate response"]');
    regenerate?.focus();

    await act(async () => {
      regenerate?.click();
      await Promise.resolve();
      await flushFocusFrame();
    });

    expect(document.activeElement).toBe(view.editableRef.current);
  });

  it('returns focus to the composer after edit and resend succeeds', async () => {
    const onEditUserMessage = vi.fn(async () => true);
    const view = await renderChat([{
      role: 'user',
      content: 'Original question',
      timestamp: 1,
    }], { onEditUserMessage });
    const edit = view.host.querySelector<HTMLButtonElement>('[aria-label="Edit and resend"]');
    await act(async () => edit?.click());
    const save = Array.from(view.host.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent === 'Save & resend');
    save?.focus();

    await act(async () => {
      save?.click();
      await Promise.resolve();
      await flushFocusFrame();
    });

    expect(onEditUserMessage).toHaveBeenCalledWith(0, 'Original question');
    expect(document.activeElement).toBe(view.editableRef.current);
  });

  it('keeps focus on the recovery action when it is rejected', async () => {
    const onRegenerate = vi.fn(async () => false);
    const view = await renderChat([{
      role: 'assistant',
      content: 'The AI service could not complete this reply.',
      timestamp: 1,
      turnStatus: 'failed',
      retryable: true,
    }], { onRegenerate });
    const retry = Array.from(view.host.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent === 'Try again');
    retry?.focus();

    await act(async () => {
      retry?.click();
      await Promise.resolve();
    });

    expect(document.activeElement).toBe(retry);
  });

  it('does not steal focus when the user moves to another control during recovery', async () => {
    let resolveRegenerate!: (result: boolean) => void;
    const onRegenerate = vi.fn(() => new Promise<boolean>((resolve) => {
      resolveRegenerate = resolve;
    }));
    const view = await renderChat([{
      role: 'assistant',
      content: 'The AI service could not complete this reply.',
      timestamp: 1,
      turnStatus: 'failed',
      retryable: true,
    }], { onRegenerate });
    const retry = Array.from(view.host.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent === 'Try again');
    const otherControl = document.createElement('button');
    document.body.appendChild(otherControl);
    retry?.focus();

    act(() => retry?.click());
    otherControl.focus();
    await act(async () => {
      resolveRegenerate(true);
      await Promise.resolve();
      await flushFocusFrame();
    });

    expect(document.activeElement).toBe(otherControl);
    otherControl.remove();
  });
});
