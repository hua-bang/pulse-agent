// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n';
import type { AgentChatMessage } from '../../../../types';
import * as markdown from '../utils/markdown';
import { ChatMessage } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;
const expandedTools = new Set<number>();
const noop = () => {};

async function renderMessage(message: AgentChatMessage, streaming = false) {
  if (!host) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  }
  await act(async () => {
    root?.render(
      <I18nProvider>
        <ChatMessage
          message={message}
          tools={message.toolCalls}
          index={0}
          isStreaming={streaming}
          loading={streaming}
          collapsed
          expandedTools={expandedTools}
          workspaceId="markdown-test"
          onToggleSection={noop}
          onToggleToolExpand={noop}
        />
      </I18nProvider>,
    );
  });
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  vi.restoreAllMocks();
});

describe('ChatMessage Markdown render ownership', () => {
  it('parses each ordered streaming update once, without rendering the unused text projection', async () => {
    const render = vi.spyOn(markdown, 'renderMarkdown');
    for (const text of ['Hello', 'Hello **world**', 'Hello **world**!']) {
      render.mockClear();
      await renderMessage({
        role: 'assistant', content: text, timestamp: 1,
        contentBlocks: [{ type: 'text', text }],
      }, true);
      expect(render).toHaveBeenCalledTimes(1);
      expect(render).toHaveBeenCalledWith(text, expect.objectContaining({ streaming: true }));
      expect(host?.querySelector('.chat-ordered-content')?.textContent).toContain('Hello');
    }
  });

  it('renders only the ordered blocks after settling, not their concatenated projection', async () => {
    const render = vi.spyOn(markdown, 'renderMarkdown');
    await renderMessage({
      role: 'assistant', content: 'BeforeAfter', timestamp: 1,
      contentBlocks: [
        { type: 'text', text: 'Before' },
        { type: 'tool', toolId: 1 },
        { type: 'text', text: 'After' },
      ],
      toolCalls: [{ id: 1, name: 'read', args: {}, status: 'succeeded' }],
    });
    expect(render.mock.calls.map(([text]) => text)).toEqual(['Before', 'After']);
    expect(host?.textContent).toContain('Before');
    expect(host?.textContent).toContain('After');
  });

  it('does not parse an empty ordered message', async () => {
    const render = vi.spyOn(markdown, 'renderMarkdown');
    await renderMessage({ role: 'assistant', content: '', contentBlocks: [], timestamp: 1 }, true);
    expect(render).not.toHaveBeenCalled();
  });

  it.each(['assistant', 'user'] as const)('keeps the legacy %s Markdown path', async role => {
    const render = vi.spyOn(markdown, 'renderMarkdown');
    await renderMessage({ role, content: '**Legacy**', timestamp: 1 });
    expect(render).toHaveBeenCalledTimes(1);
    expect(host?.querySelector('strong')?.textContent).toBe('Legacy');
  });
});
