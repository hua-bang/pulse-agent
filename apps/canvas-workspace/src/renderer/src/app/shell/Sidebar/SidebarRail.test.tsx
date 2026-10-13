// @vitest-environment happy-dom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { SidebarRail } from './SidebarRail';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const baseProps = (): ComponentProps<typeof SidebarRail> => ({
  activeView: 'canvas',
  panelCollapsed: false,
  onTogglePanel: vi.fn(),
  onEnterHome: vi.fn(),
  onEnterCanvas: vi.fn(),
  onEnterChat: vi.fn(),
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
    expect(labels).toEqual(['Home', 'Workspaces', 'Pulse Agent', 'Nodes', 'Plugins', 'Scheduled', 'Open settings']);
    expect(button('Workspaces').getAttribute('aria-current')).toBe('page');
    expect(button('Home').getAttribute('aria-current')).toBeNull();
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
    expect(button('Open settings').getAttribute('aria-current')).toBe('page');
  });
});
