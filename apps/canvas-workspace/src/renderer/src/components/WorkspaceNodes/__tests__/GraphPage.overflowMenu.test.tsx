// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import type { WorkspaceEntry } from '../../../hooks/useWorkspaces';
import { RightDockProvider } from '../../RightDock';

// react-force-graph-2d renders to a real <canvas> 2D/WebGL context that
// happy-dom doesn't implement — GraphPage's own logic (this test's target,
// the overflow menu) doesn't own any graph-rendering behavior, so the graph
// itself is stubbed out. The stub still exposes the imperative
// pause/resume/zoomToFit methods the overflow menu calls through `graphRef`.
vi.mock('react-force-graph-2d', () => {
  const React = require('react');
  const chainableForce = () => {
    const force: Record<string, unknown> = {};
    force.strength = vi.fn(() => force);
    force.distanceMax = vi.fn(() => force);
    force.distance = vi.fn(() => force);
    return force;
  };
  const ForceGraph2D = React.forwardRef((_props: unknown, ref: React.Ref<unknown>) => {
    React.useImperativeHandle(ref, () => ({
      pauseAnimation: vi.fn(),
      resumeAnimation: vi.fn(),
      zoomToFit: vi.fn(),
      d3Force: vi.fn(() => chainableForce()),
      d3ReheatSimulation: vi.fn(),
    }));
    return React.createElement('div', { 'data-testid': 'mock-force-graph' });
  });
  return { default: ForceGraph2D };
});

// Import after the mock is registered.
import { GraphPage } from '../GraphPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function render(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(<RightDockProvider>{node}</RightDockProvider>);
  });
}

const WORKSPACES: WorkspaceEntry[] = [{ id: 'ws-1', name: 'Workspace One' } as WorkspaceEntry];

/**
 * Re-shelled onto ui/DropdownShell (API-extension batch — see
 * ui-reuse-burndown.md). These specs pin the overflow menu's behavior: the
 * shell's close-reason distinguishes Escape (restore focus) from an
 * outside-press (don't), and the pause/density items deliberately leave the
 * menu open (only Refresh explicitly closes it) — both preserved unchanged
 * from the pre-migration bespoke implementation.
 */
describe('GraphPage overflow menu', () => {
  it('opens on trigger click and lists the three menu actions', () => {
    render(
      <I18nProvider>
        <GraphPage workspaces={WORKSPACES} />
      </I18nProvider>,
    );
    expect(host?.querySelector('.workspace-graph-toolbar__menu')).toBeNull();
    const trigger = host!.querySelector('.workspace-graph-toolbar__more button') as HTMLButtonElement;
    act(() => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    const items = host?.querySelectorAll('.workspace-graph-toolbar__menu-item');
    expect(items?.length).toBe(3);
  });

  it('pause/density clicks keep the menu open; Refresh closes it', () => {
    render(
      <I18nProvider>
        <GraphPage workspaces={WORKSPACES} />
      </I18nProvider>,
    );
    const trigger = host!.querySelector('.workspace-graph-toolbar__more button') as HTMLButtonElement;
    act(() => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    const [pauseBtn, densityBtn, refreshBtn] = Array.from(
      host!.querySelectorAll('.workspace-graph-toolbar__menu-item'),
    ) as HTMLButtonElement[];

    act(() => {
      pauseBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(host?.querySelector('.workspace-graph-toolbar__menu')).not.toBeNull();

    act(() => {
      densityBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(host?.querySelector('.workspace-graph-toolbar__menu')).not.toBeNull();

    act(() => {
      refreshBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(host?.querySelector('.workspace-graph-toolbar__menu')).toBeNull();
  });

  it('restores focus to the trigger on Escape-close', () => {
    render(
      <I18nProvider>
        <GraphPage workspaces={WORKSPACES} />
      </I18nProvider>,
    );
    const trigger = host!.querySelector('.workspace-graph-toolbar__more button') as HTMLButtonElement;
    act(() => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(host?.querySelector('.workspace-graph-toolbar__menu')).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(host?.querySelector('.workspace-graph-toolbar__menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('does NOT restore focus to the trigger on an outside-press close', () => {
    render(
      <I18nProvider>
        <GraphPage workspaces={WORKSPACES} />
      </I18nProvider>,
    );
    const trigger = host!.querySelector('.workspace-graph-toolbar__more button') as HTMLButtonElement;
    act(() => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(host?.querySelector('.workspace-graph-toolbar__menu')).not.toBeNull();
    trigger.blur();

    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    expect(host?.querySelector('.workspace-graph-toolbar__menu')).toBeNull();
    expect(document.activeElement).not.toBe(trigger);
  });

  it('ArrowDown on the closed trigger opens the menu', () => {
    render(
      <I18nProvider>
        <GraphPage workspaces={WORKSPACES} />
      </I18nProvider>,
    );
    const trigger = host!.querySelector('.workspace-graph-toolbar__more button') as HTMLButtonElement;
    act(() => {
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    });
    expect(host?.querySelector('.workspace-graph-toolbar__menu')).not.toBeNull();
  });
});
