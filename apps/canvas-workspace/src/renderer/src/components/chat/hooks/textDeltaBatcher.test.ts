import { describe, expect, it, vi } from 'vitest';
import { createTextDeltaBatcher } from './textDeltaBatcher';

const setup = () => {
  let nextHandle = 0;
  const callbacks = new Map<number, () => void>();
  const onFlush = vi.fn();
  const batcher = createTextDeltaBatcher({
    schedule: (callback) => {
      const handle = ++nextHandle;
      callbacks.set(handle, callback);
      return handle;
    },
    cancelScheduled: (handle) => callbacks.delete(handle),
    onFlush,
  });
  const runFrame = () => {
    const pending = [...callbacks.values()];
    callbacks.clear();
    pending.forEach(callback => callback());
  };
  return { batcher, callbacks, onFlush, runFrame };
};

describe('createTextDeltaBatcher', () => {
  it('coalesces every delta queued before the next frame', () => {
    const { batcher, onFlush, runFrame } = setup();
    batcher.push('one');
    batcher.push(' two');
    batcher.push(' three');
    expect(onFlush).not.toHaveBeenCalled();

    runFrame();
    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush).toHaveBeenCalledWith('one two three');
  });

  it('can flush synchronously when the stream completes', () => {
    const { batcher, callbacks, onFlush } = setup();
    batcher.push('tail');
    batcher.flush();
    expect(callbacks.size).toBe(0);
    expect(onFlush).toHaveBeenCalledWith('tail');
  });

  it('drops a queued delta when its stream is superseded', () => {
    const { batcher, onFlush, runFrame } = setup();
    batcher.push('stale');
    batcher.cancel();
    runFrame();
    expect(onFlush).not.toHaveBeenCalled();
  });
});
