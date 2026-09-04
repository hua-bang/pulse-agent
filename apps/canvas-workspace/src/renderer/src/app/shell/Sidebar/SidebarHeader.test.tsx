// @vitest-environment happy-dom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { SidebarHeader } from './SidebarHeader';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('SidebarHeader', () => {
  it('hides knowledge pages without removing the switch that can reveal them', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    const renderHeader = (nodesEnabled: boolean, graphEnabled: boolean) => (
      <I18nProvider>
        <SidebarHeader
          onToggle={vi.fn()}
          activeView="canvas"
          onEnterChat={vi.fn()}
          onEnterNodes={vi.fn()}
          onEnterGraph={vi.fn()}
          onEnterSkills={vi.fn()}
          onEnterScheduled={vi.fn()}
          nodesEnabled={nodesEnabled}
          graphEnabled={graphEnabled}
          pluginNavItems={[]}
          onNavigate={vi.fn()}
          showAddMenu={false}
          onToggleAddMenu={vi.fn()}
          onCloseAddMenu={vi.fn()}
          addMenuRef={createRef<HTMLDivElement>()}
          onNewWorkspace={vi.fn()}
          onNewFolder={vi.fn()}
          onImportWorkspace={vi.fn()}
        />
      </I18nProvider>
    );

    act(() => {
      root?.render(renderHeader(false, false));
    });

    const labels = () => [...host!.querySelectorAll('.sidebar-nav-label')]
      .map((element) => element.textContent);

    expect(labels()).toEqual(['Pulse Agent', 'Plugins', 'Scheduled']);
    expect(host.querySelector('[title="Collapse sidebar"]')).not.toBeNull();
    expect(host.querySelector('.sidebar-brand-mark')).toBeNull();
    expect(host.querySelector('.sidebar-nav-item img')?.getAttribute('width')).toBe('20');
    const navButtons = host.querySelectorAll('.sidebar-nav-item');
    expect(navButtons[1]?.querySelector('.sidebar-nav-icon svg')?.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(navButtons[2]?.querySelector('.sidebar-nav-icon svg')?.getAttribute('viewBox')).toBe('0 0 16 16');

    act(() => {
      root?.render(renderHeader(true, true));
    });

    expect(labels()).toEqual(['Pulse Agent', 'Nodes', 'Graph', 'Plugins', 'Scheduled']);
  });
});
