// @vitest-environment happy-dom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import { RightDockProvider, useDockContext } from './context';
import { RightDock } from './index';
import { dockPaneElementId, dockTabElementId } from './dock-tab-ids';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../hooks/useConsumePendingLinks', () => ({
  useConsumePendingLinks: () => undefined,
}));

vi.mock('./useDockAgentBridge', () => ({
  useDockAgentBridge: () => undefined,
}));

vi.mock('./DockPanes', () => ({
  DockPanes: () => <div data-testid="dock-panes" />,
}));

vi.mock('./DockCreationControls', () => ({
  DockCreationControls: () => null,
}));

let root: Root | null = null;
let mount: HTMLDivElement | null = null;

const SeededDock = () => {
  const { store } = useDockContext();
  const seededRef = useRef(false);
  if (!seededRef.current) {
    seededRef.current = true;
    store.setActiveWorkspace('ws-1');
    store.openNodeDetail('ws-1', 'node-1', 'Node one');
    store.openLink('https://example.com/');
  }
  return (
    <RightDock
      activeWorkspaceId="ws-1"
      activeIdReady
      chatTabEnabled
      workspaces={[]}
      onOpenNodePage={() => undefined}
    />
  );
};

const renderDock = async () => {
  mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);
  await act(async () => {
    root?.render(
      <I18nProvider>
        <RightDockProvider>
          <SeededDock />
        </RightDockProvider>
      </I18nProvider>,
    );
    await Promise.resolve();
  });
  return mount;
};

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, 'canvasWorkspace', {
    configurable: true,
    value: {
      link: {
        onOpen: () => () => undefined,
      },
    },
  });
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 1200,
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  act(() => root?.unmount());
  mount?.remove();
  root = null;
  mount = null;
});

describe('RightDock tab keyboard navigation', () => {
  it('keeps one tab in the tab order and activates/focuses Arrow, Home, and End targets', async () => {
    const host = await renderDock();
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];

    expect(tabs).toHaveLength(3);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, -1, 0]);

    tabs[2].focus();
    act(() => {
      tabs[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);

    act(() => {
      tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    });
    expect(document.activeElement).toBe(tabs[0]);

    act(() => {
      tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    expect(document.activeElement).toBe(tabs[2]);

    act(() => {
      tabs[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(document.activeElement).toBe(tabs[0]);
  });

  it('gives every tab a stable id and pane relationship', async () => {
    const host = await renderDock();
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];

    expect(tabs[0]).toMatchObject({
      id: dockTabElementId('chat'),
    });
    expect(tabs[0].getAttribute('aria-controls')).toBe(dockPaneElementId('chat'));

    for (const tab of tabs) {
      const dockTabId = tab.dataset.dockTabId;
      expect(dockTabId).toBeTruthy();
      expect(tab.id).toBe(dockTabElementId(dockTabId!));
      expect(tab.getAttribute('aria-controls')).toBe(dockPaneElementId(dockTabId!));
    }
  });
});

describe('RightDock keyboard resize separator', () => {
  it('exposes its range and persists ArrowLeft/ArrowRight width changes', async () => {
    const host = await renderDock();
    const dock = host.querySelector<HTMLElement>('.right-dock')!;
    const separator = host.querySelector<HTMLElement>('.right-dock__resize-handle')!;

    expect(separator.tabIndex).toBe(0);
    expect(separator.getAttribute('aria-valuemin')).toBe('320');
    expect(separator.getAttribute('aria-valuemax')).toBe('1140');
    expect(separator.getAttribute('aria-valuenow')).toBe('480');

    act(() => {
      separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(dock.style.width).toBe('504px');
    expect(separator.getAttribute('aria-valuenow')).toBe('504');
    expect(window.localStorage.getItem('canvas-workspace:right-dock-width')).toBe('504');

    act(() => {
      separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(dock.style.width).toBe('480px');
    expect(window.localStorage.getItem('canvas-workspace:right-dock-width')).toBe('480');
  });
});

describe('RightDock Escape ownership', () => {
  it('leaves handled, composing, and editable Escape events to inner editors', async () => {
    const host = await renderDock();
    const tabCount = () => host.querySelectorAll('[role="tab"]').length;
    expect(tabCount()).toBe(3);

    const prevented = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    prevented.preventDefault();
    act(() => window.dispatchEvent(prevented));
    expect(tabCount()).toBe(3);

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      isComposing: true,
    })));
    expect(tabCount()).toBe(3);

    const input = document.createElement('input');
    host.querySelector('.right-dock')?.appendChild(input);
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
    })));
    expect(tabCount()).toBe(3);

    const activeTab = host.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
    act(() => activeTab?.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
    })));
    expect(tabCount()).toBe(2);
  });
});
