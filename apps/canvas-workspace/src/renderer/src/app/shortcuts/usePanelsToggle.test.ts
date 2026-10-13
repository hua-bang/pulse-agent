// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { usePanelsToggle } from './usePanelsToggle';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

/** Real state for both panels, so each press sees the previous result. */
const mountPanels = (initial: { sidebarCollapsed: boolean; dockExpanded: boolean }) => {
  const panels = { ...initial };
  let toggle: () => void = () => undefined;
  let rerender: () => void = () => undefined;

  const Harness = () => {
    toggle = usePanelsToggle({
      sidebarCollapsed: panels.sidebarCollapsed,
      toggleSidebar: () => {
        panels.sidebarCollapsed = !panels.sidebarCollapsed;
        rerender();
      },
      isDockExpanded: () => panels.dockExpanded,
      collapseDock: () => { panels.dockExpanded = false; },
      expandDock: () => { panels.dockExpanded = true; },
    });
    return null;
  };

  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  rerender = () => root?.render(createElement(Harness));
  act(() => rerender());

  return {
    panels,
    press: () => act(() => toggle()),
  };
};

describe('usePanelsToggle', () => {
  it('hides both panels, then restores both', () => {
    const { panels, press } = mountPanels({ sidebarCollapsed: false, dockExpanded: true });

    press();
    expect(panels).toEqual({ sidebarCollapsed: true, dockExpanded: false });

    press();
    expect(panels).toEqual({ sidebarCollapsed: false, dockExpanded: true });
  });

  it('restores only the panel that was open before', () => {
    const { panels, press } = mountPanels({ sidebarCollapsed: true, dockExpanded: true });

    press();
    expect(panels).toEqual({ sidebarCollapsed: true, dockExpanded: false });

    press();
    expect(panels).toEqual({ sidebarCollapsed: true, dockExpanded: true });
  });

  it('shows both panels when both start hidden', () => {
    const { panels, press } = mountPanels({ sidebarCollapsed: true, dockExpanded: false });

    press();
    expect(panels).toEqual({ sidebarCollapsed: false, dockExpanded: true });
  });
});
