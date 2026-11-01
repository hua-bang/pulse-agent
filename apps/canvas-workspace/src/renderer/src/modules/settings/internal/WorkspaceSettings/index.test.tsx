// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n';
import { WorkspaceSettingsDrawer } from '.';

vi.mock('../settings-config/McpManager', () => ({ McpManager: () => null }));
vi.mock('../../../../shared/appShell', () => ({ useAppShell: () => ({ confirm: vi.fn(async () => true) }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const workspace = { id: 'ws-1', name: 'Demo', rootFolder: '/repo' };
const docPath = '/repo/pulse-workspace.md';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  delete (window as { canvasWorkspace?: unknown }).canvasWorkspace;
});

const render = async (file: { read: unknown; write: unknown }) => {
  (window as { canvasWorkspace?: unknown }).canvasWorkspace = { file };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <I18nProvider>
        <WorkspaceSettingsDrawer
          workspace={workspace}
          onClose={vi.fn()}
          onRename={vi.fn()}
          onSetRootFolder={vi.fn()}
        />
      </I18nProvider>,
    );
  });
};

const editAndSave = async (content: string) => {
  const textarea = document.querySelector<HTMLTextAreaElement>('.workspace-settings-textarea')!;
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setValue.call(textarea, content);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const save = document.querySelector<HTMLButtonElement>('.workspace-settings-footer button:last-child')!;
  await act(async () => save.click());
};

describe('WorkspaceSettingsDrawer pulse-workspace.md save', () => {
  it('saves against the version it read and chains the saved version', async () => {
    const read = vi.fn(async () => ({ ok: true, content: '# Demo', version: 'sha256:a' }));
    const write = vi.fn()
      .mockResolvedValueOnce({ ok: true, version: 'sha256:b' })
      .mockResolvedValueOnce({ ok: true, version: 'sha256:c' });
    await render({ read, write });

    await editAndSave('# Demo\nfirst');
    expect(write).toHaveBeenLastCalledWith(docPath, '# Demo\nfirst', 'sha256:a');
    await editAndSave('# Demo\nsecond');
    expect(write).toHaveBeenLastCalledWith(docPath, '# Demo\nsecond', 'sha256:b');
  });

  it('keeps the draft and reports a conflict when the file changed meanwhile', async () => {
    const read = vi.fn(async () => ({ ok: true, content: '# Demo', version: 'sha256:a' }));
    const write = vi.fn(async () => ({ ok: false, conflict: true, error: 'changed' }));
    await render({ read, write });

    await editAndSave('# Demo\nmine');
    expect(document.querySelector('.workspace-settings-error')?.textContent)
      .toContain('pulse-workspace.md changed after you opened it');
    expect(document.querySelector<HTMLTextAreaElement>('.workspace-settings-textarea')!.value)
      .toBe('# Demo\nmine');
  });

  it('creates a missing file without a version', async () => {
    const read = vi.fn(async () => ({ ok: false, error: 'ENOENT' }));
    const write = vi.fn(async () => ({ ok: true, version: 'sha256:new' }));
    await render({ read, write });

    await editAndSave('# Demo\nnew');
    expect(write).toHaveBeenLastCalledWith(docPath, '# Demo\nnew', undefined);
  });
});
