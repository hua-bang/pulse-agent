// @vitest-environment happy-dom
import type { IBufferRange } from '@xterm/xterm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTerminalLinkHandler } from './terminalLinkHandler';

const openExternal = vi.fn();
const RANGE = {} as IBufferRange;

function activate(url: string) {
  createTerminalLinkHandler().activate({} as MouseEvent, url, RANGE);
}

function dialogButtons() {
  const buttons = document.querySelectorAll<HTMLButtonElement>('.terminal-link-confirm button');
  return { cancel: buttons[0], confirm: buttons[1] };
}

beforeEach(() => {
  openExternal.mockReset();
  Object.defineProperty(window, 'canvasWorkspace', {
    configurable: true,
    value: { shell: { openExternal } },
  });
});

afterEach(() => {
  document.querySelectorAll('.terminal-link-confirm').forEach((el) => el.remove());
  vi.restoreAllMocks();
});

describe('createTerminalLinkHandler', () => {
  // xterm's own default (native window.confirm + window.open()) is silently
  // blocked by this app's setWindowOpenHandler, since window.open() has no
  // URL yet when the popup policy runs. Regression: activating a link must
  // reach shell.openExternal with the real URL, not window.open().
  it('opens the link through shell.openExternal when the user confirms', async () => {
    activate('https://code.byted.org/ecom/client_ai_kits/merge_requests/new');

    const dialog = document.querySelector('.terminal-link-confirm');
    expect(dialog).toBeTruthy();
    expect(dialog?.textContent).toContain('https://code.byted.org/ecom/client_ai_kits/merge_requests/new');

    dialogButtons().confirm.click();
    await Promise.resolve();

    expect(openExternal).toHaveBeenCalledWith('https://code.byted.org/ecom/client_ai_kits/merge_requests/new');
    expect(document.querySelector('.terminal-link-confirm')).toBeNull();
  });

  it('does not open the link when the user cancels', async () => {
    activate('https://example.com');

    dialogButtons().cancel.click();
    await Promise.resolve();

    expect(openExternal).not.toHaveBeenCalled();
    expect(document.querySelector('.terminal-link-confirm')).toBeNull();
  });

  it('ignores a second activation while a confirmation is already open', () => {
    activate('https://example.com/first');
    activate('https://example.com/second');

    expect(document.querySelectorAll('.terminal-link-confirm')).toHaveLength(1);
    expect(document.querySelector('.terminal-link-confirm')?.textContent).toContain('https://example.com/first');
  });
});
