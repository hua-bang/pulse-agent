// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppShortcuts } from './useAppShortcuts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('useAppShortcuts', () => {
  const mount = (overrides: Partial<Parameters<typeof useAppShortcuts>[0]> = {}) => {
    const options: Parameters<typeof useAppShortcuts>[0] = {
      activeView: 'canvas',
      isOverlayOpen: false,
      openShortcuts: vi.fn(),
      toggleChatPage: vi.fn(),
      toggleSidebar: vi.fn(),
      selectWorkspaceByIndex: vi.fn(),
      leaveChatPage: vi.fn(),
      ...overrides,
    };
    const Harness = () => {
      useAppShortcuts(options);
      return null;
    };
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(createElement(Harness)));
    return options;
  };

  const press = (init: KeyboardEventInit & { key: string }, target?: EventTarget) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    act(() => { (target ?? window).dispatchEvent(event); });
    return event;
  };

  it('toggles the chat page and the sidebar', () => {
    const options = mount();

    press({ key: 'l', metaKey: true, shiftKey: true });
    press({ key: '\\', metaKey: true });

    expect(options.toggleChatPage).toHaveBeenCalledTimes(1);
    expect(options.toggleSidebar).toHaveBeenCalledTimes(1);
  });

  it('jumps to the nth workspace', () => {
    const options = mount();

    press({ key: '3', metaKey: true });

    expect(options.selectWorkspaceByIndex).toHaveBeenCalledWith(3);
  });

  it('opens the shortcuts panel with ?', () => {
    const options = mount();

    press({ key: '?', shiftKey: true });

    expect(options.openShortcuts).toHaveBeenCalledTimes(1);
  });

  it('leaves ? alone while typing', () => {
    const options = mount();
    const input = document.createElement('input');
    document.body.append(input);

    press({ key: '?', shiftKey: true }, input);
    input.remove();

    expect(options.openShortcuts).not.toHaveBeenCalled();
  });

  // Cmd+K and friends stay live in a text field on purpose — blocking them
  // is what made every focused input (and every terminal) a black hole.
  it('still switches workspaces while a text field has focus', () => {
    const options = mount();
    const input = document.createElement('input');
    document.body.append(input);

    press({ key: '2', metaKey: true }, input);
    input.remove();

    expect(options.selectWorkspaceByIndex).toHaveBeenCalledWith(2);
  });

  it('returns from the chat page on Escape, and only there', () => {
    const onChat = mount({ activeView: 'chat' });
    press({ key: 'Escape' });
    expect(onChat.leaveChatPage).toHaveBeenCalledTimes(1);

    act(() => root?.unmount());
    const onCanvas = mount({ activeView: 'canvas' });
    press({ key: 'Escape' });
    expect(onCanvas.leaveChatPage).not.toHaveBeenCalled();
  });

  // The canvas layer marks Escape as consumed when it closed something, so
  // one press can no longer close a canvas overlay AND leave the chat page.
  it('ignores an event another layer already consumed', () => {
    const options = mount({ activeView: 'chat' });

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    event.preventDefault();
    act(() => { window.dispatchEvent(event); });

    expect(options.leaveChatPage).not.toHaveBeenCalled();
  });

  it('stands down while an overlay owns the keyboard', () => {
    const options = mount({ isOverlayOpen: true });

    press({ key: 'l', metaKey: true, shiftKey: true });

    expect(options.toggleChatPage).not.toHaveBeenCalled();
  });
});
