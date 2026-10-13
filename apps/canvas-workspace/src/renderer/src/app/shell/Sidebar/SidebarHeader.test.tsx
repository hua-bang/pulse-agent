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
  it('keeps the panel collapse control and the workspace add menu, with navigation on the rail', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const onToggle = vi.fn();

    act(() => {
      root?.render(
        <I18nProvider>
          <SidebarHeader
            onToggle={onToggle}
            showAddMenu={false}
            onToggleAddMenu={vi.fn()}
            onCloseAddMenu={vi.fn()}
            addMenuRef={createRef<HTMLDivElement>()}
            onNewWorkspace={vi.fn()}
            onNewFolder={vi.fn()}
            onImportWorkspace={vi.fn()}
          />
        </I18nProvider>,
      );
    });

    expect(host.querySelector('.sidebar-nav-item')).toBeNull();
    expect(host.querySelector('[aria-label="Add workspace or folder"]')).not.toBeNull();
    act(() => host!.querySelector<HTMLButtonElement>('[title="Collapse sidebar"]')?.click());
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
