// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../i18n';
import { ChatMentionPopup } from '..';
import type { MentionItem } from '../../../../../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ChatMentionPopup', () => {
  it('portals above embedded app surfaces while preserving composer focus and resize/hide behavior', async () => {
    const callbacks: Array<() => void> = [];
    const observed: Element[] = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { callbacks.push(callback); }
      observe(element: Element) { observed.push(element); }
      disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return Number.parseFloat(this.style.width) || 320;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(200);
    host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.zIndex = '1100';
    const editor = document.createElement('div');
    editor.tabIndex = 0;
    host.appendChild(editor);
    const mount = document.createElement('div');
    host.appendChild(mount);
    document.body.appendChild(host);
    let width = 320;
    vi.spyOn(editor, 'getBoundingClientRect').mockImplementation(() => ({
      left: 100, top: 400, right: 100 + width, bottom: 500, width, height: 100,
      x: 100, y: 400, toJSON: () => ({}),
    }));
    editor.focus();
    const selected = vi.fn();
    root = createRoot(mount);
    await act(async () => root?.render(
      <I18nProvider>
        <ChatMentionPopup
          anchorRef={{ current: editor }}
          mentionItems={[{ type: 'role', roleId: 'reviewer', label: 'Reviewer' }]}
          mentionIndex={0}
          onSelectMention={selected}
          onMentionIndexChange={vi.fn()}
        />
      </I18nProvider>,
    ));
    const popup = document.querySelector<HTMLElement>('.chat-mention-popup')!;
    expect(popup.parentElement).toBe(document.body);
    expect(popup.style).toMatchObject({ width: '320px', left: '100px', top: '196px', visibility: 'visible' });
    expect(document.activeElement).toBe(editor);
    expect(observed).toContain(editor);
    width = 400;
    act(() => callbacks.forEach(callback => callback()));
    expect(popup.style.width).toBe('400px');
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    act(() => popup.querySelector('button')?.dispatchEvent(press));
    expect(press.defaultPrevented).toBe(true);
    expect(selected).toHaveBeenCalledTimes(1);
    await act(async () => {
      host!.style.visibility = 'hidden';
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(popup.style.visibility).toBe('hidden');
  });

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
            anchorRef={{ current: host }}
            mentionItems={mentionItems}
            mentionIndex={1}
            onSelectMention={vi.fn()}
            onMentionIndexChange={vi.fn()}
          />
        </I18nProvider>,
      );
    });

    const listbox = document.querySelector<HTMLElement>('[role="listbox"]');
    expect(listbox?.id).toBe('chat-mention-listbox');
    expect(listbox?.getAttribute('aria-label')).toBe('Mention suggestions');

    const options = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]'));
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

  it('distinguishes accessible loading and empty states', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <I18nProvider>
          <ChatMentionPopup
            anchorRef={{ current: host }}
            mentionItems={[]}
            mentionIndex={0}
            isLoading
            onSelectMention={vi.fn()}
            onMentionIndexChange={vi.fn()}
          />
        </I18nProvider>,
      );
    });

    const listbox = document.querySelector<HTMLElement>('[role="listbox"]');
    const status = document.querySelector<HTMLElement>('[role="status"]');
    expect(listbox?.getAttribute('aria-busy')).toBe('true');
    expect(status?.textContent).toContain('Searching mentions');
    expect(listbox?.contains(status ?? null)).toBe(false);
    expect(document.querySelector('.chat-spin')).not.toBeNull();
    expect(document.body.textContent).not.toContain('No matching mentions');

    await act(async () => {
      root?.render(
        <I18nProvider>
          <ChatMentionPopup
            anchorRef={{ current: host }}
            mentionItems={[]}
            mentionIndex={0}
            onSelectMention={vi.fn()}
            onMentionIndexChange={vi.fn()}
          />
        </I18nProvider>,
      );
    });

    expect(listbox?.getAttribute('aria-busy')).toBe('false');
    expect(document.querySelector('[role="status"]')?.textContent).toBe('No matching mentions');
    expect(document.querySelector('.chat-spin')).toBeNull();
  });
});
