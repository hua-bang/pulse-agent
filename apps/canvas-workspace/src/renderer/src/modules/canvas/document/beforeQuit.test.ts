// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerWorkspacePersistence } from '../../../shared/workspacePersistence';
import { BEFORE_QUIT_EVENT, installBeforeQuitFlush } from './beforeQuit';

afterEach(() => {
  Reflect.deleteProperty(window, 'canvasWorkspace');
});

describe('before-quit flush', () => {
  it('lets node bodies write first, flushes every workspace, then answers main', async () => {
    const order: string[] = [];
    let request: ((requestId: string) => void) | undefined;
    const flushedBeforeQuit = vi.fn(() => order.push('answered'));
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: {
        store: {
          onFlushBeforeQuit: (callback: (requestId: string) => void) => { request = callback; return () => undefined; },
          flushedBeforeQuit,
        },
      },
    });
    const onEvent = () => order.push('node state');
    window.addEventListener(BEFORE_QUIT_EVENT, onEvent);
    const unregisterA = registerWorkspacePersistence('a', async () => { order.push('flush a'); });
    const unregisterB = registerWorkspacePersistence('b', async () => { throw new Error('save failed'); });

    installBeforeQuitFlush();
    request?.('quit-1');
    await vi.waitFor(() => expect(flushedBeforeQuit).toHaveBeenCalledWith('quit-1'));

    expect(order).toEqual(['node state', 'flush a', 'answered']);
    window.removeEventListener(BEFORE_QUIT_EVENT, onEvent);
    unregisterA();
    unregisterB();
  });
});
