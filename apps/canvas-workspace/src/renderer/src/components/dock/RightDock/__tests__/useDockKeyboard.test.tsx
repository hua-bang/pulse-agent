// @vitest-environment happy-dom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DockShortcutRequest } from '../../../../../../shared/dock-shortcuts';
import { registerMountedWebviewIdentity } from '../../../node-bodies/IframeNodeBody/webview-identities';
import { FIND_IN_DOCK_TAB_EVENT } from '../dock-browser-commands';
import { DockStore } from '../dock-store';
import { dockTabElementId } from '../dock-tab-ids';
import { useDockKeyboard } from '../useDockKeyboard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let shortcutListener: ((request: DockShortcutRequest) => void) | null = null;
let root: Root | null = null;
let mount: HTMLDivElement | null = null;

beforeEach(() => {
  shortcutListener = null;
  Object.defineProperty(window, 'canvasWorkspace', {
    configurable: true,
    value: {
      dock: {
        onShortcut: (listener: (request: DockShortcutRequest) => void) => {
          shortcutListener = listener;
          return () => {
            if (shortcutListener === listener) shortcutListener = null;
          };
        },
      },
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  mount?.remove();
  root = null;
  mount = null;
});

describe('useDockKeyboard guest shortcut ownership', () => {
  it('accepts commands only from the visible active dock guest identity', () => {
    const store = new DockStore();
    store.setActiveWorkspace('ws1');
    store.openLink('https://a.example/');
    const tabId = store.getSnapshot().activeTabId;
    const identity = {
      workspaceId: 'ws1',
      nodeId: tabId,
      webContentsId: 42,
      surfaceKind: 'dock-browser' as const,
    };
    const unregister = registerMountedWebviewIdentity(identity);

    const Harness = ({ visible }: { visible: boolean }) => {
      const dockRef = useRef<HTMLElement>(null);
      useDockKeyboard({
        store,
        visible,
        newTabTitle: 'New tab',
        dockRef,
        orderedTabIds: [tabId],
        onCollapse: () => store.collapse(),
      });
      return <aside ref={dockRef} />;
    };

    mount = document.createElement('div');
    document.body.appendChild(mount);
    root = createRoot(mount);
    act(() => root?.render(<Harness visible={false} />));

    act(() => shortcutListener?.({ command: 'close-tab', source: identity }));
    expect(store.getSnapshot().tabs).toHaveLength(1);

    act(() => root?.render(<Harness visible />));
    act(() => shortcutListener?.({
      command: 'close-tab',
      source: { ...identity, workspaceId: 'ws-retained' },
    }));
    expect(store.getSnapshot().tabs).toHaveLength(1);

    act(() => shortcutListener?.({ command: 'close-tab', source: identity }));
    expect(store.getSnapshot().tabs).toHaveLength(0);
    unregister();
  });

  it('opens the active web tab find bar even when host focus is outside the dock', () => {
    const store = new DockStore();
    store.setActiveWorkspace('ws1');
    store.openLink('https://a.example/');
    const tabId = store.getSnapshot().activeTabId;
    const onFind = vi.fn();

    const Harness = () => {
      const dockRef = useRef<HTMLElement>(null);
      useDockKeyboard({
        store,
        visible: true,
        newTabTitle: 'New tab',
        dockRef,
        orderedTabIds: [tabId],
        onCollapse: () => store.collapse(),
      });
      return (
        <>
          <button id="outside-dock">Outside</button>
          <aside ref={dockRef} />
        </>
      );
    };

    mount = document.createElement('div');
    document.body.appendChild(mount);
    window.addEventListener(FIND_IN_DOCK_TAB_EVENT, onFind);
    root = createRoot(mount);
    act(() => root?.render(<Harness />));
    mount.querySelector<HTMLButtonElement>('#outside-dock')?.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'f',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => window.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(onFind).toHaveBeenCalledWith(expect.objectContaining({
      detail: { workspaceId: 'ws1', tabId },
    }));
    window.removeEventListener(FIND_IN_DOCK_TAB_EVENT, onFind);
  });

  it('opens the active tab find bar from a focused guest Ctrl+F relay', () => {
    const store = new DockStore();
    store.setActiveWorkspace('ws1');
    store.openLink('https://a.example/');
    const tabId = store.getSnapshot().activeTabId;
    const identity = {
      workspaceId: 'ws1',
      nodeId: tabId,
      webContentsId: 42,
      surfaceKind: 'dock-browser' as const,
    };
    const unregister = registerMountedWebviewIdentity(identity);
    const onFind = vi.fn();

    const Harness = () => {
      const dockRef = useRef<HTMLElement>(null);
      useDockKeyboard({
        store,
        visible: true,
        newTabTitle: 'New tab',
        dockRef,
        orderedTabIds: [tabId],
        onCollapse: () => store.collapse(),
      });
      return <aside ref={dockRef} />;
    };

    mount = document.createElement('div');
    document.body.appendChild(mount);
    window.addEventListener(FIND_IN_DOCK_TAB_EVENT, onFind);
    root = createRoot(mount);
    act(() => root?.render(<Harness />));

    act(() => shortcutListener?.({ command: 'find', source: identity }));

    expect(onFind).toHaveBeenCalledWith(expect.objectContaining({
      detail: { workspaceId: 'ws1', tabId },
    }));
    window.removeEventListener(FIND_IN_DOCK_TAB_EVENT, onFind);
    unregister();
  });

  it('moves focus to the successor after Escape closes a terminal', async () => {
    const store = new DockStore();
    store.setActiveWorkspace('ws1');
    store.openNodeDetail('ws1', 'node-1', 'Node one');
    const successorId = store.getSnapshot().activeTabId;
    store.openTerminal();

    const Harness = () => {
      const dockRef = useRef<HTMLElement>(null);
      useDockKeyboard({
        store,
        visible: true,
        newTabTitle: 'New tab',
        dockRef,
        orderedTabIds: [successorId, store.getSnapshot().activeTabId],
        onCollapse: () => store.collapse(),
      });
      return (
        <aside ref={dockRef}>
          <button id={dockTabElementId(successorId)}>Node one</button>
        </aside>
      );
    };

    mount = document.createElement('div');
    document.body.appendChild(mount);
    root = createRoot(mount);
    act(() => root?.render(<Harness />));

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
    })));
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });

    expect(store.getSnapshot().activeTabId).toBe(successorId);
    expect(document.activeElement?.id).toBe(dockTabElementId(successorId));
  });
});
