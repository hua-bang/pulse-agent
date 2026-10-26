// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchShortcut } from '../../shortcuts/registry';
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
      isOverlayOpen: false,
      openShortcuts: vi.fn(),
      toggleChatPage: vi.fn(),
      toggleSidebar: vi.fn(),
      togglePanels: vi.fn(),
      selectWorkspaceByIndex: vi.fn(),
      closeActiveTab: vi.fn(() => true),
      toggleDockChat: vi.fn(() => true),
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

  it('closes the active tab with Mod+W, even from a text field', () => {
    const options = mount();
    const input = document.createElement('input');
    document.body.append(input);

    const event = press({ key: 'w', ctrlKey: true }, input);

    expect(options.closeActiveTab).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    input.remove();
  });

  it('toggles the dock chat with Mod+Shift+A off the canvas route', () => {
    const options = mount();
    expect(press({ key: 'A', ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(options.toggleDockChat).toHaveBeenCalledTimes(1);
  });

  it('leaves Mod+Shift+A to the canvas layer on the canvas route', () => {
    const options = mount({ toggleDockChat: vi.fn(() => false) });
    expect(press({ key: 'A', ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(options.toggleDockChat).toHaveBeenCalledTimes(1);
  });

  it('leaves Mod+W alone when no tab bar is showing', () => {
    const options = mount({ closeActiveTab: vi.fn(() => false) });

    const event = press({ key: 'w', metaKey: true });

    expect(options.closeActiveTab).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
  });

  it('toggles the chat page and the sidebar', () => {
    const options = mount();

    press({ key: 'l', metaKey: true, shiftKey: true });
    press({ key: '\\', metaKey: true });

    expect(options.toggleChatPage).toHaveBeenCalledTimes(1);
    expect(options.toggleSidebar).toHaveBeenCalledTimes(1);
  });

  it('hides both panels with Mod+Shift+F, even from a text field', () => {
    const options = mount();
    const input = document.createElement('input');
    document.body.append(input);

    const event = press({ key: 'F', metaKey: true, shiftKey: true }, input);

    expect(options.togglePanels).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    input.remove();
  });

  it('toggles the theme with Mod+Shift+D, even from a text field', () => {
    mount();
    const input = document.createElement('input');
    document.body.append(input);
    const wasDark = document.documentElement.classList.contains('dark');

    const event = press({ key: 'D', metaKey: true, shiftKey: true }, input);

    expect(document.documentElement.classList.contains('dark')).toBe(!wasDark);
    expect(event.defaultPrevented).toBe(true);
    input.remove();
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

  it('leaves Escape to local controls, never app navigation', () => {
    const options = mount();
    const event = press({ key: 'Escape' });
    expect(matchShortcut(event, 'app')).toBeNull();
    expect(options.toggleChatPage).not.toHaveBeenCalled();
    expect(options.selectWorkspaceByIndex).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores a navigation chord another layer already consumed', () => {
    const options = mount();
    const event = new KeyboardEvent('keydown', {
      key: 'l', metaKey: true, shiftKey: true, bubbles: true, cancelable: true,
    });
    event.preventDefault();
    act(() => { window.dispatchEvent(event); });
    expect(options.toggleChatPage).not.toHaveBeenCalled();
  });

  it('stands down while an overlay owns the keyboard', () => {
    const options = mount({ isOverlayOpen: true });

    press({ key: 'l', metaKey: true, shiftKey: true });

    expect(options.toggleChatPage).not.toHaveBeenCalled();
  });
});
