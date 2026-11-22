// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDockSqueezesPanel, useSidebarLayout } from './useSidebarLayout';

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

describe('useSidebarLayout rail in a narrow window', () => {
  let host: HTMLDivElement;
  let root: Root;
  let layout: ReturnType<typeof useSidebarLayout>;

  const Probe = () => {
    layout = useSidebarLayout({ panelRequested: true });
    return null;
  };

  const resize = (width: number) => act(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    window.dispatchEvent(new Event('resize'));
  });

  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1400 });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<Probe />));
  });

  const setDockInset = async (px: number) => {
    await act(async () => {
      document.documentElement.style.setProperty('--right-dock-inset', `${px}px`);
      await Promise.resolve();
    });
  };

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.documentElement.style.removeProperty('--right-dock-inset');
  });

  it('shows the icon rail while narrow and keeps the saved preference', () => {
    expect(layout.railExpanded).toBe(true);
    resize(900);
    expect(layout.railExpanded).toBe(false);
    expect(layout.width).toBe(48 + 224);
    act(() => layout.toggleRail());
    expect(layout.railExpanded).toBe(true);
    resize(1400);
    expect(layout.railExpanded).toBe(true);
    resize(900);
    expect(layout.railExpanded).toBe(false);
  });

  it('auto-collapses the rail when an open dock crowds a 1200px window and restores on close', async () => {
    resize(1200);
    expect(layout.railExpanded).toBe(true);

    await setDockInset(480);
    expect(layout.railExpanded).toBe(false);
    expect(layout.panelHidden).toBe(true);
    expect(layout.width).toBe(48);

    // User can still expand the rail temporarily while the dock is open.
    act(() => layout.toggleRail());
    expect(layout.railExpanded).toBe(true);

    // Closing the dock restores the saved expanded preference.
    await setDockInset(0);
    expect(layout.railExpanded).toBe(true);
    expect(layout.panelHidden).toBe(false);
  });

  it('keeps the expanded rail beside an open dock on wide windows and respects manual collapse', async () => {
    resize(1440);
    await setDockInset(480);
    expect(layout.railExpanded).toBe(true);

    await setDockInset(0);
    act(() => layout.toggleRail());
    expect(layout.railExpanded).toBe(false);

    resize(1200);
    await setDockInset(480);
    expect(layout.railExpanded).toBe(false);
    await setDockInset(0);
    expect(layout.railExpanded).toBe(false);
  });
});
