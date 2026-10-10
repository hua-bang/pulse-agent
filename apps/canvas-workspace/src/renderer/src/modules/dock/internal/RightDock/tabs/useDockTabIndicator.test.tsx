// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDockTabIndicator } from './useDockTabIndicator';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Strip = ({ scopeId, tabIds, activeTabId }: {
  scopeId: string;
  tabIds: string[];
  activeTabId: string;
}) => {
  const indicator = useDockTabIndicator({
    scopeId,
    activeTabId,
    visible: true,
    previewTabs: tabIds.map(id => ({ id })),
    terminalTabs: [],
    chatTabEnabled: false,
    dockWidth: 480,
  });
  return (
    <div ref={indicator.tabsRef} data-testid="scroll">
      <span data-testid="glider" data-snap={indicator.snap || undefined} />
      {tabIds.map(id => (
        <button key={id} ref={element => indicator.registerTab(id, element)}>{id}</button>
      ))}
    </div>
  );
};

let root: Root | null = null;
let mount: HTMLDivElement | null = null;
const scrollIntoView = vi.fn();
const scrollTo = vi.fn();
const frames: FrameRequestCallback[] = [];

const render = (props: Parameters<typeof Strip>[0]) => {
  act(() => root!.render(<Strip {...props} />));
};

const flushFrame = () => {
  const pending = frames.splice(0);
  act(() => {
    for (const frame of pending) frame(0);
  });
};

beforeEach(() => {
  mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);
  scrollIntoView.mockClear();
  scrollTo.mockClear();
  frames.length = 0;
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  act(() => root?.unmount());
  mount?.remove();
  root = null;
  mount = null;
  vi.unstubAllGlobals();
});

describe('useDockTabIndicator', () => {
  it('keeps the smooth slide for a tab change inside one workspace', () => {
    render({ scopeId: 'ws-a', tabIds: ['a1', 'a2'], activeTabId: 'a1' });
    scrollIntoView.mockClear();

    render({ scopeId: 'ws-a', tabIds: ['a1', 'a2'], activeTabId: 'a2' });

    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
    expect(mount!.querySelector('[data-testid="glider"]')?.hasAttribute('data-snap')).toBe(false);
  });

  it('snaps the strip into place on a workspace switch instead of sliding', () => {
    render({ scopeId: 'ws-a', tabIds: ['a1', 'a2'], activeTabId: 'a2' });
    scrollIntoView.mockClear();

    render({ scopeId: 'ws-b', tabIds: ['b1', 'b2', 'b3'], activeTabId: 'b3' });

    expect(scrollTo).toHaveBeenCalledWith({ left: 0, behavior: 'instant' });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'instant' }));
    const glider = mount!.querySelector('[data-testid="glider"]');
    expect(glider?.getAttribute('data-snap')).toBe('true');

    flushFrame();
    expect(glider?.getAttribute('data-snap')).toBe('true');
    flushFrame();
    expect(glider?.hasAttribute('data-snap')).toBe(false);
  });
});
