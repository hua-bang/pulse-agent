// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLiveAgentOutput } from './useLiveAgentOutput';

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let seen: Array<string | undefined> = [];
const getScrollback = vi.fn();

const Probe = ({ sessionId }: { sessionId?: string }) => {
  seen.push(useLiveAgentOutput(sessionId));
  return null;
};

const render = async (sessionId?: string) => {
  await act(async () => {
    root?.render(<Probe sessionId={sessionId} />);
    await Promise.resolve();
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  seen = [];
  getScrollback.mockReset();
  Object.defineProperty(window, 'canvasWorkspace', {
    configurable: true,
    value: { pty: { getScrollback } },
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  Reflect.deleteProperty(window, 'canvasWorkspace');
  vi.useRealTimers();
});

describe('useLiveAgentOutput', () => {
  it('polls main for the selected session and stops when it is cleared', async () => {
    getScrollback.mockResolvedValueOnce({ ok: true, text: 'first' }).mockResolvedValue({ ok: true, text: 'second' });
    await render('pty-1');
    expect(getScrollback).toHaveBeenCalledWith('pty-1', 20_000);
    expect(seen.at(-1)).toBe('first');

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(seen.at(-1)).toBe('second');

    await render(undefined);
    const calls = getScrollback.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(getScrollback).toHaveBeenCalledTimes(calls);
    expect(seen.at(-1)).toBeUndefined();
  });
});
