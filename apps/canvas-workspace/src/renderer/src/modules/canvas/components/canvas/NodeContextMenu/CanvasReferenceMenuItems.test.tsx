// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../i18n';
import { CanvasReferenceMenuItems } from './CanvasReferenceMenuItems';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('opens the workspace list in place and creates a reference for the picked canvas', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const onCreate = vi.fn();
  const root = createRoot(host);
  try {
    act(() => root.render(
      <I18nProvider>
        <CanvasReferenceMenuItems
          workspaces={[{ id: 'a', name: 'Research' }, { id: 'b', name: 'Roadmap' }]}
          onCreate={onCreate}
        />
      </I18nProvider>,
    ));
    expect(host.querySelectorAll('.context-menu-workspace')).toHaveLength(0);
    act(() => (host.querySelector('[aria-expanded]') as HTMLButtonElement).click());
    const rows = host.querySelectorAll<HTMLButtonElement>('.context-menu-workspace');
    expect([...rows].map((row) => row.textContent)).toEqual(['Research', 'Roadmap']);
    act(() => rows[1].click());
    expect(onCreate).toHaveBeenCalledWith('b');

    act(() => root.render(
      <I18nProvider>
        <CanvasReferenceMenuItems workspaces={[]} onCreate={onCreate} />
      </I18nProvider>,
    ));
    expect(host.textContent).toBe('');
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
