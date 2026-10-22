// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDockSqueezesPanel } from './useDockSqueezesPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useDockSqueezesPanel', () => {
  let host: HTMLDivElement;
  let root: Root;
  let squeezed = false;

  const Probe = () => {
    squeezed = useDockSqueezesPanel(48, 224);
    return null;
  };

  const setDockInset = async (px: number) => {
    await act(async () => {
      document.documentElement.style.setProperty('--right-dock-inset', `${px}px`);
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<Probe />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.documentElement.style.removeProperty('--right-dock-inset');
  });

  it('hides the panel only while the open dock leaves too little canvas', async () => {
    expect(squeezed).toBe(false);
    await setDockInset(480);
    expect(squeezed).toBe(true);
    await setDockInset(320);
    expect(squeezed).toBe(false);
    await setDockInset(0);
    expect(squeezed).toBe(false);
  });
});
