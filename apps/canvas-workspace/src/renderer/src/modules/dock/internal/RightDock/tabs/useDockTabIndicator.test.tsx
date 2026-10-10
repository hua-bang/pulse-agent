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

const render = (props: Parameters<typeof Strip>[0]) => {
  act(() => root!.render(<Strip {...props} />));
};

beforeEach(() => {
  mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);
  scrollIntoView.mockClear();
  scrollTo.mockClear();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo });
});

afterEach(() => {
  act(() => root?.unmount());
  mount?.remove();
  root = null;
  mount = null;
});

describe('useDockTabIndicator', () => {
  it('keeps the smooth slide for a tab change inside one workspace', () => {
    render({ scopeId: 'ws-a', tabIds: ['a1', 'a2'], activeTabId: 'a1' });
    scrollIntoView.mockClear();

    render({ scopeId: 'ws-a', tabIds: ['a1', 'a2'], activeTabId: 'a2' });

    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
  });

  it('scrolls a new workspace strip into place instantly instead of sliding', () => {
    render({ scopeId: 'ws-a', tabIds: ['a1', 'a2'], activeTabId: 'a2' });
    scrollIntoView.mockClear();

    render({ scopeId: 'ws-b', tabIds: ['b1', 'b2', 'b3'], activeTabId: 'b3' });

    expect(scrollTo).toHaveBeenCalledWith({ left: 0, behavior: 'instant' });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'instant' }));
  });
});
