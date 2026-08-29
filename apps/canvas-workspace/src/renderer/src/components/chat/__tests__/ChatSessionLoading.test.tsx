// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { ChatMessages } from '../ChatMessages';
import { ChatView } from '../ChatView';
import type { AgentChatMessage, CanvasModelStatus } from '../../../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

const messagesProps = {
  workspaceId: 'ws-1',
  streamingTools: [],
  messageTools: new Map(),
  collapsedSections: new Set<number>(),
  expandedTools: new Set<number>(),
  pendingClarify: null,
  clarifyInput: '',
  onClarifyInputChange: vi.fn(),
  onAnswerClarification: vi.fn(async () => undefined),
  onToggleSection: vi.fn(),
  onToggleToolExpand: vi.fn(),
};

const viewProps = {
  ...messagesProps,
  onQuickAction: vi.fn(),
  input: '',
  editableRef: { current: null },
  mentionOpen: false,
  mentionItems: [],
  mentionIndex: 0,
  onSelectMention: vi.fn(),
  onMentionIndexChange: vi.fn(),
  onInput: vi.fn(),
  onKeyDown: vi.fn(),
  onPaste: vi.fn(),
  onSubmit: vi.fn(async () => true),
  onAbort: vi.fn(async () => true),
};

const PRIOR_SESSION: AgentChatMessage[] = [
  { role: 'user', content: 'from the session we are leaving', timestamp: 1 },
  { role: 'assistant', content: 'stale reply', timestamp: 2 },
];

const UNCONFIGURED_MODEL: CanvasModelStatus = {
  path: '/config',
  currentProvider: '',
  currentModel: '',
  providerType: 'openai',
  resolvedModel: '',
  apiKeyPresent: false,
  options: [],
  providers: [],
};

async function render(ui: React.ReactNode): Promise<HTMLDivElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<I18nProvider>{ui}</I18nProvider>);
  });
  return host;
}

describe('session-detail loading state', () => {
  it('keeps the previous thread unchanged while the next session is fetched', async () => {
    const el = await render(
      <ChatMessages {...messagesProps} messages={PRIOR_SESSION} loading={false} sessionLoading />,
    );

    expect(el.querySelector('.chat-thread-skeleton')).toBeNull();
    expect(el.textContent).toContain('from the session we are leaving');
    expect(el.querySelector('.chat-messages')?.classList.contains('chat-messages--session-loading')).toBe(true);
    expect(el.querySelector('.chat-messages')?.getAttribute('aria-busy')).toBe('true');
  });

  it('renders the real thread once the fetch settles', async () => {
    const el = await render(
      <ChatMessages {...messagesProps} messages={PRIOR_SESSION} loading={false} sessionLoading={false} />,
    );

    expect(el.querySelector('.chat-thread-skeleton')).toBeNull();
    expect(el.textContent).toContain('from the session we are leaving');
    expect(el.querySelector('.chat-messages')?.getAttribute('aria-busy')).toBeNull();
  });

  it('delays the skeleton so fast scope switches do not flash', async () => {
    vi.useFakeTimers();
    // A cross-scope switch remounts with an empty thread; without
    // sessionLoading in the seam, ChatView fell through to the empty state
    // for the whole IPC round trip.
    const el = await render(
      <ChatView {...viewProps} messages={[]} loading={false} sessionLoading />,
    );

    expect(el.querySelector('.chat-thread-skeleton')).toBeNull();
    expect(el.querySelector('.chat-empty-state')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(180);
    });
    expect(el.querySelector('.chat-thread-skeleton')).not.toBeNull();
    vi.useRealTimers();
  });

  it('falls back to the empty state for a genuinely empty session', async () => {
    const el = await render(
      <ChatView {...viewProps} messages={[]} loading={false} sessionLoading={false} />,
    );

    expect(el.querySelector('.chat-thread-skeleton')).toBeNull();
    expect(el.querySelector('.chat-empty-state')).not.toBeNull();
  });

  it('keeps model setup in the composer as the single empty-chat entry', async () => {
    const onOpenModelSettings = vi.fn();
    const el = await render(
      <ChatView
        {...viewProps}
        messages={[]}
        loading={false}
        contextComposer
        modelStatus={UNCONFIGURED_MODEL}
        modelSelection={{ mode: 'auto' }}
        modelLabel="Auto"
        onSelectModel={vi.fn(async () => undefined)}
        onOpenModelSettings={onOpenModelSettings}
      />,
    );

    expect(el.querySelectorAll('.chat-model-switcher-btn--warning')).toHaveLength(1);
    expect(el.querySelector('.chat-empty-configure-banner')).toBeNull();

    act(() => {
      el.querySelector<HTMLButtonElement>('.chat-model-switcher-btn--warning')?.click();
    });
    expect(onOpenModelSettings).toHaveBeenCalledTimes(1);
  });
});
