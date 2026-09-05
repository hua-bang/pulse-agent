// @vitest-environment happy-dom
import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useMcpAppSurfacePlacement } from '../useMcpAppSurfacePlacement';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const layout = (element: HTMLElement, x: number, y: number, width: number, height: number) => {
  element.getBoundingClientRect = () => new DOMRect(x, y, width, height);
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: height });
};

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

const mount = async () => {
  const pane = document.createElement('div');
  const scroller = document.createElement('div');
  const anchor = document.createElement('div');
  const surface = document.createElement('div');
  const frame = document.createElement('iframe');
  const host = document.createElement('div');
  pane.append(scroller);
  scroller.append(anchor, host);
  surface.append(frame);
  document.body.append(pane, surface);
  scroller.style.overflow = 'auto';
  layout(scroller, 100, 100, 600, 500);
  layout(anchor, 120, 120, 560, 320);
  const root = createRoot(host);
  const Harness = ({ mode, shown }: { mode: 'inline' | 'fullscreen'; shown: boolean }) => {
    useMcpAppSurfacePlacement({
      displayMode: mode, dockHost: anchor, dockTabVisible: shown, height: 320,
      inlineHostRef: useRef(anchor), surfaceRef: useRef(surface),
      instanceId: 'placement-test', resourceKey: 'resource',
    });
    return null;
  };
  const render = async (mode: 'inline' | 'fullscreen' = 'inline', shown = true) => {
    await act(async () => { root.render(<Harness mode={mode} shown={shown} />); });
  };
  await render();
  cleanups.push(async () => {
    await act(async () => { root.unmount(); });
    pane.remove();
    surface.remove();
  });
  const mutate = async (change: () => void) => {
    await act(async () => {
      change();
      await new Promise(resolve => setTimeout(resolve, 10));
    });
  };
  return { pane, scroller, anchor, surface, frame, render, mutate };
};

describe('MCP App portal placement', () => {
  it('hides retained inline apps when their pane is hidden and restores without reparenting', async () => {
    const { pane, surface, frame, mutate } = await mount();
    expect(surface.style.visibility).toBe('visible');
    await mutate(() => { pane.style.visibility = 'hidden'; });
    expect(surface.style.visibility).toBe('hidden');
    expect(surface.style.pointerEvents).toBe('none');
    await mutate(() => { pane.style.visibility = ''; });
    expect(surface.style.visibility).toBe('visible');
    await mutate(() => { pane.setAttribute('aria-hidden', 'true'); });
    expect(surface.style.visibility).toBe('hidden');
    await mutate(() => { pane.removeAttribute('aria-hidden'); });
    expect(surface.style.visibility).toBe('visible');
    expect(surface.firstChild).toBe(frame);
    expect(frame.parentElement).toBe(surface);
  });

  it('clips to scrollport on both axes while preserving the full iframe viewport', async () => {
    const { anchor, scroller, surface, frame } = await mount();
    layout(anchor, 80, 40, 660, 600);
    scroller.dispatchEvent(new Event('scroll'));
    expect(surface.style.clipPath).toBe('inset(60px 40px 40px 20px)');
    expect(surface.style.width).toBe('660px');
    expect(surface.style.height).toBe('600px');
    expect(surface.style.visibility).toBe('visible');
    layout(anchor, 120, -250, 560, 320);
    scroller.dispatchEvent(new Event('scroll'));
    expect(surface.style.visibility).toBe('hidden');
    expect(surface.style.pointerEvents).toBe('none');
    layout(anchor, 120, 120, 560, 320);
    scroller.dispatchEvent(new Event('scroll'));
    expect(surface.style.visibility).toBe('visible');
    expect(surface.style.clipPath).toBe('inset(0px 0px 0px 0px)');
    expect(surface.firstChild).toBe(frame);
  });

  it('never shows zero-sized or display-none anchors', async () => {
    const { pane, anchor, surface, mutate } = await mount();
    await mutate(() => { pane.style.display = 'none'; });
    expect(surface.style.visibility).toBe('hidden');
    await mutate(() => { pane.style.display = ''; });
    layout(anchor, 0, 0, 0, 0);
    window.dispatchEvent(new Event('resize'));
    expect(surface.style.visibility).toBe('hidden');
  });

  it('hides inactive fullscreen tabs and restores the same surface', async () => {
    const { surface, frame, render } = await mount();
    await render('fullscreen', true);
    expect(surface.style.visibility).toBe('visible');
    await render('fullscreen', false);
    expect(surface.style.visibility).toBe('hidden');
    await render('fullscreen', true);
    expect(surface.style.visibility).toBe('visible');
    expect(surface.firstChild).toBe(frame);
  });
});
