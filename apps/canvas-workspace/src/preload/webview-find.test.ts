// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOCK_FIND_FALLBACK_CHANNEL } from '../shared/dock-shortcuts';

const electronMocks = vi.hoisted(() => ({ sendToHost: vi.fn() }));

vi.mock('electron', () => ({
  ipcRenderer: { sendToHost: electronMocks.sendToHost },
}));

let teardown: (() => void) | undefined;

const loadBridge = async () => {
  const module = await import('./webview-find');
  teardown = module.teardownWebviewFindFallbackBridge;
};

const pressFind = (): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', {
    key: 'f',
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event;
};

const flushFallback = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.resetModules();
  electronMocks.sendToHost.mockReset();
});

afterEach(() => {
  teardown?.();
  teardown = undefined;
});

describe('webview find fallback bridge', () => {
  it('notifies the host when the page leaves Ctrl/Cmd+F unhandled', async () => {
    await loadBridge();

    pressFind();
    await flushFallback();

    expect(electronMocks.sendToHost).toHaveBeenCalledOnce();
    expect(electronMocks.sendToHost).toHaveBeenCalledWith(DOCK_FIND_FALLBACK_CHANNEL);
  });

  it('stays silent when page code prevents the Find default', async () => {
    await loadBridge();
    const claimFind = (event: KeyboardEvent) => event.preventDefault();
    window.addEventListener('keydown', claimFind);

    const event = pressFind();
    await flushFallback();
    window.removeEventListener('keydown', claimFind);

    expect(event.defaultPrevented).toBe(true);
    expect(electronMocks.sendToHost).not.toHaveBeenCalled();
  });

  it('stays silent when page code stops Find propagation without preventing default', async () => {
    await loadBridge();
    const claimFind = (event: KeyboardEvent) => event.stopPropagation();
    window.addEventListener('keydown', claimFind);

    const event = pressFind();
    await flushFallback();
    window.removeEventListener('keydown', claimFind);

    expect(event.defaultPrevented).toBe(false);
    expect(event.cancelBubble).toBe(true);
    expect(electronMocks.sendToHost).not.toHaveBeenCalled();
  });

  it('waits past an isolated-world microtask checkpoint for page cancellation', async () => {
    await loadBridge();
    const claimFind = (event: KeyboardEvent) => {
      queueMicrotask(() => event.preventDefault());
    };
    window.addEventListener('keydown', claimFind);

    const event = pressFind();
    await flushFallback();
    window.removeEventListener('keydown', claimFind);

    expect(event.defaultPrevented).toBe(true);
    expect(electronMocks.sendToHost).not.toHaveBeenCalled();
  });

  it('ignores shifted, alt-modified, and repeated variants', async () => {
    await loadBridge();
    for (const init of [
      { shiftKey: true },
      { altKey: true },
      { repeat: true },
    ]) {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'f',
        metaKey: true,
        bubbles: true,
        cancelable: true,
        ...init,
      }));
    }
    await flushFallback();

    expect(electronMocks.sendToHost).not.toHaveBeenCalled();
  });
});
