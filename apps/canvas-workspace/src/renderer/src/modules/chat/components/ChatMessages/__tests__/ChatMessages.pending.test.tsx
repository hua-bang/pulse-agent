// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../i18n';
import { ChatMessages } from '..';
import { setConversationCompacting } from '../../../runtime/conversationCompaction';

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

describe('ChatMessages scheduled pending state', () => {
  it('renders host progress copy as the latest assistant message', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <I18nProvider>
          <ChatMessages
            messages={[]}
            loading={false}
            workspaceId="scheduled-memory-report"
            streamingTools={[]}
            messageTools={new Map()}
            collapsedSections={new Set()}
            expandedTools={new Set()}
            pendingClarify={null}
            clarifyInput=""
            onClarifyInputChange={vi.fn()}
            onAnswerClarification={vi.fn(async () => undefined)}
            onToggleSection={vi.fn()}
            onToggleToolExpand={vi.fn()}
            pendingLabel="Pulse AI is working on this task…"
          />
        </I18nProvider>,
      );
    });

    expect(host.querySelector('.chat-message-assistant')).not.toBeNull();
    expect(host.querySelector('.chat-loading-label')?.textContent)
      .toBe('Pulse AI is working on this task…');
  });

  it('labels a running compaction with an animated status', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const render = async (loading: boolean) => {
      await act(async () => {
        root?.render(
          <I18nProvider>
            <ChatMessages
              messages={[{ role: 'user', content: 'hi', timestamp: 1 }]}
              loading={loading}
              workspaceId="ws"
              conversationKey="session-compacting"
              streamingTools={[]}
              messageTools={new Map()}
              collapsedSections={new Set()}
              expandedTools={new Set()}
              pendingClarify={null}
              clarifyInput=""
              onClarifyInputChange={vi.fn()}
              onAnswerClarification={vi.fn(async () => undefined)}
              onToggleSection={vi.fn()}
              onToggleToolExpand={vi.fn()}
            />
          </I18nProvider>,
        );
      });
    };

    await render(true);
    expect(host.querySelector('.chat-activity-status--compacting')).toBeNull();

    await act(async () => { setConversationCompacting('session-compacting', true); });
    expect(host.querySelector('.chat-activity-status--compacting .chat-activity-status__label')?.textContent)
      .toBe('Compacting context…');

    await act(async () => { setConversationCompacting('session-compacting', false); });
    expect(host.querySelector('.chat-activity-status--compacting')).toBeNull();
  });
});
