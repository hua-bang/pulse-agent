// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { ChatAnchors } from '../ChatAnchors';
import type { ChatAnchor } from '../utils/anchors';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function render(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(node);
  });
}

const ANCHORS: ChatAnchor[] = [
  { index: 0, label: 'First turn' },
  { index: 2, label: 'Second turn' },
];

/**
 * Re-shelled onto ui/DropdownShell (API-extension batch — see
 * ui-reuse-burndown.md). These specs pin the two behaviors the pre-migration
 * bespoke component had that DropdownShell doesn't provide out of the box
 * (hover-driven open/close, focus restore ONLY on keyboard-close) plus what
 * the shell now owns for free (outside-press close, item-pick close).
 */
describe('ChatAnchors', () => {
  it('renders nothing when there are no anchors', () => {
    render(
      <I18nProvider>
        <ChatAnchors anchors={[]} onJump={vi.fn()} />
      </I18nProvider>,
    );
    expect(host?.innerHTML).toBe('');
  });

  it('opens on trigger click and lists anchors in order', () => {
    render(
      <I18nProvider>
        <ChatAnchors anchors={ANCHORS} onJump={vi.fn()} />
      </I18nProvider>,
    );
    expect(host?.querySelector('.chat-anchors-menu')).toBeNull();
    act(() => {
      host!.querySelector('.chat-panel-action-btn')!.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    const items = host?.querySelectorAll('.chat-anchors-menu-item');
    expect(items?.length).toBe(2);
    expect(items?.[0].textContent).toContain('First turn');
    expect(items?.[1].textContent).toContain('Second turn');
  });

  it('opens on mouseenter and closes shortly after mouseleave', () => {
    vi.useFakeTimers();
    render(
      <I18nProvider>
        <ChatAnchors anchors={ANCHORS} onJump={vi.fn()} />
      </I18nProvider>,
    );
    // React derives onMouseEnter/onMouseLeave from native mouseover/mouseout
    // (it doesn't listen for the native, non-bubbling mouseenter/mouseleave
    // events at its root), so the DOM-level simulation dispatches those.
    const wrapper = host!.querySelector('.chat-anchors') as HTMLElement;
    act(() => {
      wrapper.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, relatedTarget: null }));
    });
    expect(host?.querySelector('.chat-anchors-menu')).not.toBeNull();

    act(() => {
      wrapper.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, cancelable: true, relatedTarget: null }));
    });
    // Still open immediately after leave — the close is debounced.
    expect(host?.querySelector('.chat-anchors-menu')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(host?.querySelector('.chat-anchors-menu')).toBeNull();
    vi.useRealTimers();
  });

  it('clicking an item closes the menu and reports the jump', () => {
    const onJump = vi.fn();
    render(
      <I18nProvider>
        <ChatAnchors anchors={ANCHORS} onJump={onJump} />
      </I18nProvider>,
    );
    act(() => {
      host!.querySelector('.chat-panel-action-btn')!.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    const secondItem = host?.querySelectorAll('.chat-anchors-menu-item')[1] as HTMLElement;
    act(() => {
      secondItem.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onJump).toHaveBeenCalledWith(2);
    expect(host?.querySelector('.chat-anchors-menu')).toBeNull();
  });

  it('restores focus to the trigger on Escape-close', () => {
    render(
      <I18nProvider>
        <ChatAnchors anchors={ANCHORS} onJump={vi.fn()} />
      </I18nProvider>,
    );
    const trigger = host!.querySelector('.chat-panel-action-btn') as HTMLButtonElement;
    act(() => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(host?.querySelector('.chat-anchors-menu')).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(host?.querySelector('.chat-anchors-menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('does NOT restore focus to the trigger on an outside-press close', () => {
    render(
      <I18nProvider>
        <ChatAnchors anchors={ANCHORS} onJump={vi.fn()} />
      </I18nProvider>,
    );
    const trigger = host!.querySelector('.chat-panel-action-btn') as HTMLButtonElement;
    act(() => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(host?.querySelector('.chat-anchors-menu')).not.toBeNull();
    trigger.blur();

    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    expect(host?.querySelector('.chat-anchors-menu')).toBeNull();
    expect(document.activeElement).not.toBe(trigger);
  });

  it('ArrowDown on the closed trigger opens the menu', () => {
    render(
      <I18nProvider>
        <ChatAnchors anchors={ANCHORS} onJump={vi.fn()} />
      </I18nProvider>,
    );
    const trigger = host!.querySelector('.chat-panel-action-btn') as HTMLButtonElement;
    act(() => {
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    });
    expect(host?.querySelector('.chat-anchors-menu')).not.toBeNull();
  });
});
