// @vitest-environment happy-dom
import { act, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { ChatTarget, ChatTargetBroker } from '../../../../modules/chat';
import { useChatNavigation } from '../useChatNavigation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const target: ChatTarget = {
  surface: 'dock',
  scope: { kind: 'workspace', workspaceId: 'workspace-a' },
  scopeId: 'workspace-a',
  sessionId: 'session-a',
  composerId: 'dock:workspace-a',
  contextSnapshot: { label: 'Workspace A' },
  executionPolicy: 'auto',
};

describe('useChatNavigation', () => {
  it('toggles full-page chat back to its source and restores focus', async () => {
    let latest: ReturnType<typeof useChatNavigation> | undefined;
    const deliver: ChatTargetBroker['deliver'] = vi.fn(async () => ({
      status: 'delivered' as const,
      target,
    }));
    const broker = {
      deliver,
      getActiveTarget: () => target,
      register: vi.fn(),
      subscribe: vi.fn(),
    } satisfies ChatTargetBroker;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    const Harness = () => {
      const [location, setLocation] = useState('/nodes');
      latest = useChatNavigation({
        activeView: location === '/chat' ? 'chat' : 'nodes',
        location,
        setLocation,
        activeTarget: target,
        broker,
        openDockChat: vi.fn(),
        isOverlayOpen: false,
        openShortcuts: vi.fn(),
      });
      return <button id="source">Source</button>;
    };
    await act(async () => root.render(<Harness />));
    const source = host.querySelector<HTMLButtonElement>('#source')!;
    source.focus();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'L',
        metaKey: true,
        shiftKey: true,
      }));
    });
    expect(latest?.initialTarget).toEqual(target);
    expect(latest?.isChatView).toBe(true);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'L',
        metaKey: true,
        shiftKey: true,
      }));
      await new Promise(resolve => requestAnimationFrame(resolve));
    });
    expect(latest?.isChatView).toBe(false);
    expect(document.activeElement).toBe(source);

    act(() => root.unmount());
    host.remove();
  });

  it('commits the entry target before the chat route first renders', async () => {
    // wouter keeps the location in an external store, which re-renders
    // synchronously and skips state updates still pending from async code.
    let path = '/';
    const listeners = new Set<() => void>();
    const store = {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      get: () => path,
      set: (next: string) => {
        path = next;
        listeners.forEach(listener => listener());
      },
    };
    const broker = {
      deliver: vi.fn(),
      getActiveTarget: () => null,
      register: vi.fn(),
      subscribe: vi.fn(),
    } satisfies ChatTargetBroker;
    const chatRenders: Array<ChatTarget | null> = [];
    let enter: ((next: ChatTarget) => void) | undefined;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    const Harness = () => {
      const location = useSyncExternalStore(store.subscribe, store.get);
      const navigation = useChatNavigation({
        activeView: location === '/chat' ? 'chat' : 'home',
        location,
        setLocation: store.set,
        activeTarget: null,
        broker,
        openDockChat: vi.fn(),
        isOverlayOpen: false,
        openShortcuts: vi.fn(),
      });
      enter = navigation.enterChatTarget;
      if (location === '/chat') chatRenders.push(navigation.initialTarget);
      return null;
    };
    await act(async () => root.render(<Harness />));

    await act(async () => {
      await Promise.resolve();
      enter?.(target);
    });
    expect(chatRenders[0]).toBe(target);

    act(() => root.unmount());
    host.remove();
  });

  it('makes Cmd/Ctrl+Shift+A open the dock and focus its composer', async () => {
    let latest: ReturnType<typeof useChatNavigation> | undefined;
    const openDockChat = vi.fn();
    const deliver: ChatTargetBroker['deliver'] = vi.fn(async () => ({
      status: 'delivered' as const,
      target,
    }));
    const broker = {
      deliver,
      getActiveTarget: () => target,
      register: vi.fn(),
      subscribe: vi.fn(),
    } satisfies ChatTargetBroker;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    const Harness = () => {
      latest = useChatNavigation({
        activeView: 'canvas',
        location: '/',
        setLocation: vi.fn(),
        activeTarget: null,
        broker,
        openDockChat,
        isOverlayOpen: false,
        openShortcuts: vi.fn(),
      });
      return null;
    };
    await act(async () => root.render(<Harness />));

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'a',
        ctrlKey: true,
        shiftKey: true,
      }));
      await new Promise(resolve => requestAnimationFrame(resolve));
    });

    expect(openDockChat).toHaveBeenCalledOnce();
    expect(deliver).toHaveBeenCalledWith({ kind: 'focus' });
    expect(latest?.isChatView).toBe(false);

    act(() => root.unmount());
    host.remove();
  });

  it('opens a selected historical session in its owning page target', () => {
    let latest: ReturnType<typeof useChatNavigation> | undefined;
    let location = '/';
    const pageTarget: ChatTarget = {
      ...target,
      surface: 'page',
      scope: { kind: 'global' },
      scopeId: '__global_chat__',
      sessionId: 'global-session',
      composerId: 'page:__global_chat__',
      contextSnapshot: { label: 'Global chat' },
    };
    const broker = {
      deliver: vi.fn(async () => ({ status: 'unavailable' as const, target: null })),
      getActiveTarget: () => target,
      register: vi.fn(),
      subscribe: vi.fn(),
    } satisfies ChatTargetBroker;
    const host = document.createElement('div');
    const root = createRoot(host);
    const Harness = () => {
      latest = useChatNavigation({
        activeView: location === '/chat' ? 'chat' : 'canvas',
        location,
        setLocation: (next) => { location = next; },
        activeTarget: target,
        broker,
        openDockChat: vi.fn(),
        isOverlayOpen: false,
        openShortcuts: vi.fn(),
      });
      return null;
    };
    act(() => root.render(<Harness />));
    act(() => latest?.enterChatTarget(pageTarget));

    expect(location).toBe('/chat');
    expect(latest?.initialTarget).toEqual(pageTarget);

    act(() => root.unmount());
  });

  it('retargets an already-open full-page chat without leaving the page', () => {
    let latest: ReturnType<typeof useChatNavigation> | undefined;
    const setLocation = vi.fn();
    const pageTarget: ChatTarget = {
      ...target,
      surface: 'page',
      scope: { kind: 'scheduled', taskId: 'daily-brief' },
      scopeId: '__scheduled__-daily-brief',
      sessionId: 'scheduled-run-session',
      composerId: 'page:__scheduled__-daily-brief',
      contextSnapshot: { label: 'Morning brief' },
      executionPolicy: 'scheduled',
    };
    const broker = {
      deliver: vi.fn(async () => ({ status: 'unavailable' as const, target: null })),
      getActiveTarget: () => target,
      register: vi.fn(),
      subscribe: vi.fn(),
    } satisfies ChatTargetBroker;
    const host = document.createElement('div');
    const root = createRoot(host);
    const Harness = () => {
      latest = useChatNavigation({
        activeView: 'chat',
        location: '/chat',
        setLocation,
        activeTarget: target,
        broker,
        openDockChat: vi.fn(),
        isOverlayOpen: false,
        openShortcuts: vi.fn(),
      });
      return null;
    };
    act(() => root.render(<Harness />));
    act(() => latest?.enterChatTarget(pageTarget));

    expect(latest?.initialTarget).toEqual(pageTarget);
    expect(setLocation).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it.each(['composer', 'page'])('keeps full-page chat open on Escape from %s', async (focus) => {
    const setLocation = vi.fn();
    const broker = {
      deliver: vi.fn(async () => ({ status: 'unavailable' as const, target: null })),
      getActiveTarget: () => target,
      register: vi.fn(),
      subscribe: vi.fn(),
    } satisfies ChatTargetBroker;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const Harness = () => {
      useChatNavigation({
        activeView: 'chat',
        location: '/chat',
        setLocation,
        activeTarget: { ...target, surface: 'page' },
        broker,
        openDockChat: vi.fn(),
        isOverlayOpen: false,
        openShortcuts: vi.fn(),
      });
      return <div contentEditable role="textbox" />;
    };
    await act(async () => root.render(<Harness />));
    const composer = host.querySelector<HTMLElement>('[contenteditable="true"]')!;
    act(() => (focus === 'composer' ? composer : window).dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })));

    expect(setLocation).not.toHaveBeenCalled();
    act(() => root.unmount());
    host.remove();
  });

  it('resumes the last page conversation from Pulse Agent outside the agent views', async () => {
    let latest: ReturnType<typeof useChatNavigation> | undefined;
    let setActive: ((view: string, active: ChatTarget | null) => void) | undefined;
    let workspaceExists = true;
    const setLocation = vi.fn();
    const pageTarget: ChatTarget = {
      ...target,
      surface: 'page',
      composerId: 'page:workspace-a',
    };
    const broker = {
      deliver: vi.fn(),
      getActiveTarget: () => null,
      register: vi.fn(),
      subscribe: vi.fn(),
    } satisfies ChatTargetBroker;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    const Harness = () => {
      const [state, setState] = useState<{ view: string; active: ChatTarget | null }>({ view: 'canvas', active: null });
      setActive = (view, active) => setState({ view, active });
      latest = useChatNavigation({
        activeView: state.view,
        location: '/',
        setLocation,
        activeTarget: state.active,
        broker,
        openDockChat: vi.fn(),
        isOverlayOpen: false,
        openShortcuts: vi.fn(),
        hasWorkspace: () => workspaceExists,
      });
      return null;
    };
    await act(async () => root.render(<Harness />));

    // Nothing to resume yet: open the launcher.
    act(() => latest?.enterPulseAgent());
    expect(setLocation).toHaveBeenLastCalledWith('/home');

    // A conversation on the chat page, then another destination.
    await act(async () => setActive?.('chat', pageTarget));
    // On the chat page itself, the entry still opens the launcher.
    act(() => latest?.enterPulseAgent());
    expect(setLocation).toHaveBeenLastCalledWith('/home');
    await act(async () => setActive?.('canvas', target));
    act(() => latest?.enterPulseAgent());
    expect(setLocation).toHaveBeenLastCalledWith('/chat');
    expect(latest?.initialTarget).toBe(pageTarget);

    // Visiting the launcher in between keeps the conversation to resume.
    await act(async () => setActive?.('home', null));
    act(() => latest?.enterPulseAgent());
    expect(setLocation).toHaveBeenLastCalledWith('/home');
    await act(async () => setActive?.('canvas', target));
    act(() => latest?.enterPulseAgent());
    expect(setLocation).toHaveBeenLastCalledWith('/chat');

    // A conversation whose workspace was deleted is not resumed.
    workspaceExists = false;
    act(() => latest?.enterPulseAgent());
    expect(setLocation).toHaveBeenLastCalledWith('/home');
    workspaceExists = true;
    act(() => latest?.enterPulseAgent());
    expect(setLocation).toHaveBeenLastCalledWith('/home');

    // A fresh chat with no session yet has nothing to resume.
    await act(async () => setActive?.('chat', { ...pageTarget, sessionId: null }));
    await act(async () => setActive?.('canvas', target));
    act(() => latest?.enterPulseAgent());
    expect(setLocation).toHaveBeenLastCalledWith('/home');

    act(() => root.unmount());
    host.remove();
  });
});
