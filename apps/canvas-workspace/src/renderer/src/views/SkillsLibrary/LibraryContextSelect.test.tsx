// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import { LibraryContextSelect } from './LibraryContextSelect';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let mount: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  mount?.remove();
  root = null;
  mount = null;
});

describe('LibraryContextSelect', () => {
  it('offers a global library perspective alongside workspace perspectives', async () => {
    const onChange = vi.fn();
    mount = document.createElement('div');
    document.body.appendChild(mount);
    root = createRoot(mount);

    await act(async () => {
      root?.render(
        <I18nProvider>
          <LibraryContextSelect
            value={{ kind: 'workspace', workspaceId: 'ws-1' }}
            workspaces={[{ id: 'ws-1', name: 'Pulse Canvas' }]}
            onChange={onChange}
          />
        </I18nProvider>,
      );
    });

    const trigger = mount.querySelector<HTMLButtonElement>('.ui-select__trigger')!;
    act(() => trigger.click());

    const options = [...mount.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining('Global Library'),
      expect.stringContaining('Pulse Canvas'),
    ]);

    act(() => options[0].click());
    expect(onChange).toHaveBeenCalledWith({ kind: 'global' });
  });
});
