// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFocusOnOpen } from './useFocusOnOpen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useFocusOnOpen', () => {
  let root: Root;
  let host: HTMLElement;
  let focusPending: () => void;
  let ready: boolean;
  const focus = vi.fn(() => ready);

  const Probe = ({ open, tick }: { open: boolean; tick: number }) => {
    void tick;
    focusPending = useFocusOnOpen(open, focus);
    return null;
  };

  const render = (open: boolean, tick = 0) => act(() => root.render(<Probe open={open} tick={tick} />));

  beforeEach(() => {
    host = document.createElement('div');
    root = createRoot(host);
    focus.mockClear();
    ready = true;
    Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { isActive: true } });
  });

  afterEach(() => {
    act(() => root.unmount());
    Reflect.deleteProperty(navigator, 'userActivation');
  });

  it('focuses once when opened, not on later renders', () => {
    render(false);
    render(true);
    render(true, 1);
    render(true, 2);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('focuses a panel that becomes ready after the open', () => {
    ready = false;
    render(false);
    render(true);
    ready = true;
    focusPending();
    focusPending();
    expect(focus).toHaveBeenCalledTimes(2);
  });

  it('leaves focus alone without user activation', () => {
    Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { isActive: false } });
    render(true);
    focusPending();
    expect(focus).not.toHaveBeenCalled();
  });
});
