// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n';
import { ChatMentionPopup } from '..';
import type { MentionItem } from '../../../../types';

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

describe('ChatMentionPopup', () => {
  it('exposes editor-owned selection as a listbox with options', async () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    const mentionItems: MentionItem[] = [
      { type: 'role', roleId: 'role-1', label: 'Reviewer' },
      { type: 'plugin', pluginId: 'arcade', pluginIconKey: 'arcade', label: 'Arcade' },
      { type: 'session', sessionId: 'session-1', workspaceId: 'workspace-1', label: 'Earlier chat' },
    ];
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <I18nProvider>
          <ChatMentionPopup
            mentionItems={mentionItems}
            mentionIndex={1}
            onSelectMention={vi.fn()}
            onMentionIndexChange={vi.fn()}
          />
        </I18nProvider>,
      );
    });

    const listbox = host.querySelector<HTMLElement>('[role="listbox"]');
    expect(listbox?.id).toBe('chat-mention-listbox');
    expect(listbox?.getAttribute('aria-label')).toBe('Mention suggestions');

    const options = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="option"]'));
    expect(options).toHaveLength(3);
    expect(options.map((option) => option.id)).toEqual([
      'chat-mention-option-0',
      'chat-mention-option-1',
      'chat-mention-option-2',
    ]);
    expect(options.map((option) => option.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(options.every((option) => option.tabIndex === -1)).toBe(true);
    expect(options[1].querySelector<HTMLImageElement>('.chat-plugin-brand-icon img')?.src)
      .toContain('arcade');
  });
});
