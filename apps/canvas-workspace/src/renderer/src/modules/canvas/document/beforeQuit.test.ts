// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerWorkspacePersistence } from '../../../shared/workspacePersistence';
import { flushWorkspace, registerBeforeQuit } from './beforeQuit';

afterEach(() => {
  Reflect.deleteProperty(window, 'canvasWorkspace');
});

describe('before-quit flush', () => {
  it('runs every registered task before answering main, even when one fails', async () => {
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
    const unregisterWorkspace = registerWorkspacePersistence('ws', async () => { order.push('flush ws'); });
    const unregisterA = registerBeforeQuit(async () => {
      order.push('write node');
      await flushWorkspace('ws');
    });
    const unregisterB = registerBeforeQuit(() => { throw new Error('write failed'); });
    const unregisterC = registerBeforeQuit(() => { order.push('unregistered'); });
    unregisterC();

    request?.('quit-1');
    await vi.waitFor(() => expect(flushedBeforeQuit).toHaveBeenCalledWith('quit-1'));

    expect(order).toEqual(['write node', 'flush ws', 'answered']);
    unregisterA();
    unregisterB();
    unregisterWorkspace();
  });

  it('swallows a workspace flush failure and ignores a missing workspace id', async () => {
    const unregister = registerWorkspacePersistence('broken', async () => { throw new Error('still loading'); });
    await expect(flushWorkspace('broken')).resolves.toBeUndefined();
    await expect(flushWorkspace(undefined)).resolves.toBeUndefined();
    unregister();
  });
});
