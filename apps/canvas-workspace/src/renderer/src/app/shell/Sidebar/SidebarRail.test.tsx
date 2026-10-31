// @vitest-environment happy-dom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { SidebarRail } from './SidebarRail';

vi.mock('./AppsSection', () => ({ AppsSection: () => <div data-testid="apps" /> }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const baseProps = (): ComponentProps<typeof SidebarRail> => ({
  activeView: 'canvas',
  panelCollapsed: false,
  onTogglePanel: vi.fn(),
  expanded: false,
  onToggleExpanded: vi.fn(),
  onEnterHome: vi.fn(),
  onEnterCanvas: vi.fn(),
  onEnterNodes: vi.fn(),
  onEnterGraph: vi.fn(),
  onEnterSkills: vi.fn(),
  onEnterScheduled: vi.fn(),
  onOpenAppSettings: vi.fn(),
  nodesEnabled: false,
  graphEnabled: false,
  enableSkills: true,
  enableScheduled: true,
  pluginNavItems: [],
  onNavigate: vi.fn(),
  activeMcpAppKey: null,
  workspaceFlyout: { workspaces: [], folders: [], activeId: '', onSelect: vi.fn(), onCreate: vi.fn() },
});

const render = (props: ComponentProps<typeof SidebarRail>) => act(() => root.render(
  <I18nProvider><SidebarRail {...props} /></I18nProvider>,
));

const button = (label: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('SidebarRail', () => {
  it('lists the top-level destinations with Settings last and marks the current one', () => {
    render({ ...baseProps(), nodesEnabled: true });

    const labels = [...host.querySelectorAll('.sidebar-rail-btn')].map((el) => el.getAttribute('aria-label'));
    expect(labels).toEqual(['Pulse Agent', 'Workspaces', 'Knowledge', 'Plugins', 'Scheduled', 'Show labels', 'Settings']);
    expect(button('Workspaces').getAttribute('aria-current')).toBe('page');
    expect(button('Pulse Agent').getAttribute('aria-current')).toBeNull();
  });

  it('keeps Knowledge current across its list, graph and detail views', () => {
    for (const activeView of ['nodes', 'graph', 'node-detail']) {
      render({ ...baseProps(), activeView, nodesEnabled: true });
      expect(button('Knowledge').getAttribute('aria-current')).toBe('page');
    }
  });

  it('opens the launcher from Pulse Agent and keeps it current on home and chat', () => {
    for (const activeView of ['home', 'chat']) {
      const props = { ...baseProps(), activeView };
      render(props);
      expect(button('Pulse Agent').getAttribute('aria-current')).toBe('page');
      act(() => button('Pulse Agent').click());
      expect(props.onEnterHome).toHaveBeenCalledOnce();
    }
  });

  it('toggles the panel from Workspaces on the canvas and returns to the canvas elsewhere', () => {
    const onCanvas = baseProps();
    render(onCanvas);
    act(() => button('Workspaces').click());
    expect(onCanvas.onTogglePanel).toHaveBeenCalledOnce();
    expect(onCanvas.onEnterCanvas).not.toHaveBeenCalled();

    const onSettings = { ...baseProps(), activeView: 'settings' };
    render(onSettings);
    act(() => button('Workspaces').click());
    expect(onSettings.onEnterCanvas).toHaveBeenCalledOnce();
    expect(button('Settings').getAttribute('aria-current')).toBe('page');
  });

  it('widens to show labels from the toggle above Settings', () => {
    const props = baseProps();
    render(props);
    act(() => button('Show labels').click());
    expect(props.onToggleExpanded).toHaveBeenCalledOnce();

    render({ ...props, expanded: true });
    expect(button('Hide labels').textContent).toBe('');
    expect(button('Settings').textContent).toBe('Settings');
  });

  it('shows the apps above the workspace tree on the wide rail', () => {
    render({ ...baseProps(), expanded: true, onOpenMcpApp: vi.fn(), tree: <div data-testid="tree" /> });

    const order = [...host.querySelectorAll('[data-testid]')].map((el) => el.getAttribute('data-testid'));
    expect(order).toEqual(['apps', 'tree']);
  });

  it('lists workspaces on hover over the narrow rail, opens the picked one, and creates one', async () => {
    const onSelect = vi.fn();
    const onCreate = vi.fn();
    const workspaceFlyout = {
      workspaces: [
        { id: 'a', name: 'Alpha', folderId: 'f1' },
        { id: 'b', name: 'Beta' },
      ],
      folders: [{ id: 'f1', name: 'Work' }],
      activeId: 'b',
      onSelect,
      onCreate,
    };
    const hover = () => act(() => {
      button('Workspaces').parentElement!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });

    render({ ...baseProps(), workspaceFlyout });
    hover();
    const flyout = await vi.waitFor(() => {
      const panel = document.querySelector('.sidebar-flyout');
      expect(panel).not.toBeNull();
      return panel!;
    });
    const names = [...flyout.querySelectorAll('.sidebar-flyout-name')].map((el) => el.textContent);
    expect(names).toEqual(['Alpha', 'Beta', 'New workspace']);
    expect(flyout.querySelector('[aria-current="true"]')?.textContent).toBe('Beta');

    act(() => (flyout.querySelectorAll('.sidebar-flyout-item')[0] as HTMLButtonElement).click());
    expect(onSelect).toHaveBeenCalledWith('a');
    expect(document.querySelector('.sidebar-flyout')).toBeNull();

    act(() => {
      button('Workspaces').parentElement!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
    hover();
    const reopened = await vi.waitFor(() => {
      const panel = document.querySelector('.sidebar-flyout');
      expect(panel).not.toBeNull();
      return panel!;
    });
    act(() => [...reopened.querySelectorAll<HTMLButtonElement>('.sidebar-flyout-item')]
      .find((item) => item.textContent === 'New workspace')!.click());
    expect(onCreate).toHaveBeenCalledOnce();
    expect(document.querySelector('.sidebar-flyout')).toBeNull();

    render({ ...baseProps(), expanded: true, workspaceFlyout });
    hover();
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(document.querySelector('.sidebar-flyout')).toBeNull();
  });
});
