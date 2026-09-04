// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppShortcuts } from '../app/shortcuts/useAppShortcuts';
import { matchShortcut } from './registry';
import { claimTerminalKey, handleTerminalShortcut } from './terminalShortcuts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let terminal: HTMLTextAreaElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  terminal?.remove();
  root = null;
  host = null;
  terminal = null;
});

/** Mounts the REAL app dispatcher, so this pins the actual collision. */
const mountAppShortcuts = () => {
  const options: Parameters<typeof useAppShortcuts>[0] = {
    activeView: 'canvas',
    isOverlayOpen: false,
    openShortcuts: vi.fn(),
    toggleChatPage: vi.fn(),
    toggleSidebar: vi.fn(),
    selectWorkspaceByIndex: vi.fn(),
    leaveChatPage: vi.fn(),
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

/**
 * Stands in for xterm: its custom key handler runs from a listener on the
 * helper `<textarea>`, i.e. while the event is still propagating toward the
 * window listeners the app dispatcher installs.
 */
const mountTerminal = (onKey?: (event: KeyboardEvent) => void) => {
  terminal = document.createElement('textarea');
  document.body.append(terminal);
  if (onKey) terminal.addEventListener('keydown', onKey);
  return terminal;
};

const pressInTerminal = (init: KeyboardEventInit & { key: string }) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => { terminal?.dispatchEvent(event); });
  return event;
};

describe('terminal-scoped shortcuts', () => {
  // The whole reason this dispatcher exists. Cmd+2 is bound by BOTH
  // terminal.mentionPicker and app.switchWorkspace; if this ever stops being
  // true the preventDefault below is no longer load-bearing and the extra
  // machinery should go.
  it('shares its chord with app.switchWorkspace', () => {
    const cmd2 = { key: '2', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false };
    expect(matchShortcut(cmd2, 'terminal')?.id).toBe('terminal.mentionPicker');
    expect(matchShortcut(cmd2, 'app')?.id).toBe('app.switchWorkspace');
  });

  // Control case: proves the collision is real and that the assertion below
  // is actually testing something. app.switchWorkspace is editable:'allow',
  // so a focused terminal textarea does NOT stop it on its own.
  it('without the terminal claim, Cmd+2 in a terminal switches workspace', () => {
    const options = mountAppShortcuts();
    mountTerminal();
    pressInTerminal({ key: '2', metaKey: true });
    expect(options.selectWorkspaceByIndex).toHaveBeenCalledWith(2);
  });

  // The regression this module was written for: returning false to xterm
  // stops xterm only, so the mention picker opened AND the workspace changed
  // underneath the user.
  it('a claimed Cmd+2 opens the picker and does NOT switch workspace', () => {
    const options = mountAppShortcuts();
    const openPicker = vi.fn();
    let claimed: boolean | undefined;
    mountTerminal((event) => {
      claimed = handleTerminalShortcut(event, { 'terminal.mentionPicker': openPicker });
    });

    const event = pressInTerminal({ key: '2', metaKey: true });

    expect(claimed).toBe(true);
    expect(openPicker).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(options.selectWorkspaceByIndex).not.toHaveBeenCalled();
  });

  it('claims Ctrl+2 too, so the chord works on every platform', () => {
    const openPicker = vi.fn();
    mountTerminal((event) => { handleTerminalShortcut(event, { 'terminal.mentionPicker': openPicker }); });
    pressInTerminal({ key: '2', ctrlKey: true });
    expect(openPicker).toHaveBeenCalledTimes(1);
  });

  it('leaves unclaimed keys to the terminal and to the app layer', () => {
    const options = mountAppShortcuts();
    const openPicker = vi.fn();
    const claims: boolean[] = [];
    mountTerminal((event) => {
      claims.push(handleTerminalShortcut(event, { 'terminal.mentionPicker': openPicker }));
    });

    // A bare 2 is shell input; Cmd+Shift+2 is an unlisted modifier (matching
    // is exact); Cmd+3 belongs to workspace switching alone.
    pressInTerminal({ key: '2' });
    pressInTerminal({ key: '2', metaKey: true, shiftKey: true });
    const cmd3 = pressInTerminal({ key: '3', metaKey: true });

    expect(claims).toEqual([false, false, false]);
    expect(openPicker).not.toHaveBeenCalled();
    expect(cmd3.defaultPrevented).toBe(true); // claimed by app.switchWorkspace itself
    expect(options.selectWorkspaceByIndex).toHaveBeenCalledWith(3);
  });

  it('ignores keyup — xterm calls its handler for both directions', () => {
    const openPicker = vi.fn();
    terminal = document.createElement('textarea');
    document.body.append(terminal);
    const event = new KeyboardEvent('keyup', { key: '2', metaKey: true, bubbles: true, cancelable: true });
    expect(handleTerminalShortcut(event, { 'terminal.mentionPicker': openPicker })).toBe(false);
    expect(openPicker).not.toHaveBeenCalled();
  });

  // The dock terminal's font-size keys override canvas.zoom* the same way,
  // without being registry-owned by the terminal.
  it('claimTerminalKey stops a borrowed chord from reaching the global layers', () => {
    const event = new KeyboardEvent('keydown', { key: '=', metaKey: true, bubbles: true, cancelable: true });
    expect(claimTerminalKey(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });
});
