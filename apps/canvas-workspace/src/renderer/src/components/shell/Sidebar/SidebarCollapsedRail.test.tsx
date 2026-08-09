// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { AppShellProvider } from '../AppShellProvider';
import { Sidebar } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('collapsed sidebar rail', () => {
  it('keeps the expand control at the top of the rail', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const noop = vi.fn();

    act(() => root.render(
      <I18nProvider>
        <AppShellProvider>
          <Sidebar
            collapsed
            onToggle={noop}
            workspaces={[]}
            folders={[]}
            activeId=""
            onSelect={noop}
            onCreate={noop}
            onRename={noop}
            onDelete={noop}
            onExport={noop}
            onOpenSettings={noop}
            onOpenAppSettings={noop}
            onImport={noop}
            onCreateFolder={noop}
            onRenameFolder={noop}
            onDeleteFolder={noop}
            onToggleFolder={noop}
            onMoveWorkspace={noop}
            onReorderWorkspace={noop}
            onReorderFolder={noop}
            activeView="canvas"
            onEnterChat={noop}
            onEnterNodes={noop}
            onEnterGraph={noop}
            onEnterSkills={noop}
            onEnterScheduled={noop}
            nodesEnabled={false}
            graphEnabled={false}
            pluginNavItems={[]}
            onNavigate={noop}
            onExitChat={noop}
          />
        </AppShellProvider>
      </I18nProvider>,
    ));

    const rail = host.querySelector('.sidebar-collapsed-rail');
    const expandButton = host.querySelector('[aria-label="Expand sidebar"]');
    expect(rail?.firstElementChild).toBe(expandButton);
    expect(rail?.children[1]?.querySelector('img')?.getAttribute('width')).toBe('20');

    act(() => root.unmount());
  });
});
