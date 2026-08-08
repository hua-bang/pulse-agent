// @vitest-environment happy-dom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
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

    const renderHeader = ({
      nodesEnabled,
      graphEnabled,
      skillsEnabled,
      scheduledEnabled,
    }: {
      nodesEnabled: boolean;
      graphEnabled: boolean;
      skillsEnabled: boolean;
      scheduledEnabled: boolean;
    }) => (
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
          skillsEnabled={skillsEnabled}
          scheduledEnabled={scheduledEnabled}
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
      root?.render(renderHeader({
        nodesEnabled: false,
        graphEnabled: false,
        skillsEnabled: false,
        scheduledEnabled: false,
      }));
    });

    const labels = () => [...host!.querySelectorAll('.sidebar-nav-label')]
      .map((element) => element.textContent);

    expect(labels()).toEqual(['AI Chat']);

    act(() => {
      root?.render(renderHeader({
        nodesEnabled: true,
        graphEnabled: true,
        skillsEnabled: true,
        scheduledEnabled: true,
      }));
    });

    expect(labels()).toEqual(['AI Chat', 'Nodes', 'Graph', 'Skills', 'Scheduled']);
  });
});
