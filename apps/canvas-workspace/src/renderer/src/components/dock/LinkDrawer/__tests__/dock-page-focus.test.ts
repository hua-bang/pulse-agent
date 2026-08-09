// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { EmbeddedWebviewTag } from '../../EmbeddedBrowser/types';
import { FOCUS_DOCK_PAGE_EVENT } from '../../RightDock/dock-browser-commands';
import { focusDockPageOrRequest } from '../useDockPageFocus';

describe('focusDockPageOrRequest', () => {
  it('keeps focus pending for a blank tab whose guest has not mounted yet', () => {
    const details: unknown[] = [];
    const listener = (event: Event) => details.push((event as CustomEvent).detail);
    window.addEventListener(FOCUS_DOCK_PAGE_EVENT, listener);

    focusDockPageOrRequest({ workspaceId: 'ws-a', tabId: 'blank-tab', webview: null });

    expect(details).toEqual([{ workspaceId: 'ws-a', tabId: 'blank-tab' }]);
    window.removeEventListener(FOCUS_DOCK_PAGE_EVENT, listener);
  });

  it('focuses an already-mounted guest immediately', () => {
    const focus = vi.fn();
    focusDockPageOrRequest({
      workspaceId: 'ws-a',
      tabId: 'loaded-tab',
      webview: { focus } as unknown as EmbeddedWebviewTag,
    });
    expect(focus).toHaveBeenCalledOnce();
  });

  it('keeps focus pending when the old guest is already disconnected', () => {
    const details: unknown[] = [];
    const listener = (event: Event) => details.push((event as CustomEvent).detail);
    window.addEventListener(FOCUS_DOCK_PAGE_EVENT, listener);
    const focus = vi.fn();

    focusDockPageOrRequest({
      workspaceId: 'ws-a',
      tabId: 'replacing-tab',
      webview: { focus, isConnected: false } as unknown as EmbeddedWebviewTag,
    });

    expect(focus).not.toHaveBeenCalled();
    expect(details).toEqual([{ workspaceId: 'ws-a', tabId: 'replacing-tab' }]);
    window.removeEventListener(FOCUS_DOCK_PAGE_EVENT, listener);
  });
});
