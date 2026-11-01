// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n';
import { WorkspaceSettingsDrawer } from '.';

vi.mock('../settings-config/McpManager', () => ({ McpManager: () => null }));
vi.mock('../../../../shared/appShell', () => ({ useAppShell: () => ({ confirm: vi.fn(async () => true) }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  delete (window as { canvasWorkspace?: unknown }).canvasWorkspace;
});

const render = async (
  agent: { readWorkspaceContext: unknown; writeWorkspaceContext: unknown },
  rootFolder?: string,
) => {
  (window as { canvasWorkspace?: unknown }).canvasWorkspace = { agent };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <I18nProvider>
        <WorkspaceSettingsDrawer
          workspace={{ id: 'ws-1', name: 'Demo', rootFolder }}
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

describe('WorkspaceSettingsDrawer workspace context', () => {
  it('edits the stored document without a root folder and chains revisions', async () => {
    const readWorkspaceContext = vi.fn(async () => ({ ok: true, content: '# Demo', revision: 3 }));
    const writeWorkspaceContext = vi.fn()
      .mockResolvedValueOnce({ ok: true, revision: 4 })
      .mockResolvedValueOnce({ ok: true, revision: 5 });
    await render({ readWorkspaceContext, writeWorkspaceContext });

    expect(readWorkspaceContext).toHaveBeenCalledWith('ws-1');
    await editAndSave('# Demo\nfirst');
    expect(writeWorkspaceContext).toHaveBeenLastCalledWith('ws-1', '# Demo\nfirst', 3);
    await editAndSave('# Demo\nsecond');
    expect(writeWorkspaceContext).toHaveBeenLastCalledWith('ws-1', '# Demo\nsecond', 4);
  });

  it('keeps the draft and reports a conflict when the agent updated the document meanwhile', async () => {
    const readWorkspaceContext = vi.fn(async () => ({ ok: true, content: '# Demo', revision: 3 }));
    const writeWorkspaceContext = vi.fn(async () => ({ ok: false, conflict: true, error: 'changed' }));
    await render({ readWorkspaceContext, writeWorkspaceContext }, '/repo');

    await editAndSave('# Demo\nmine');
    expect(document.querySelector('.workspace-settings-error')?.textContent)
      .toContain('The workspace context changed after you opened it');
    expect(document.querySelector<HTMLTextAreaElement>('.workspace-settings-textarea')!.value)
      .toBe('# Demo\nmine');
  });

  it('starts from the template and creates the first version with a null revision', async () => {
    const readWorkspaceContext = vi.fn(async () => ({ ok: true, content: '', revision: null }));
    const writeWorkspaceContext = vi.fn(async () => ({ ok: true, revision: 1 }));
    await render({ readWorkspaceContext, writeWorkspaceContext });

    expect(document.querySelector<HTMLTextAreaElement>('.workspace-settings-textarea')!.value).toContain('## Goal');
    await editAndSave('# Demo\nnew');
    expect(writeWorkspaceContext).toHaveBeenLastCalledWith('ws-1', '# Demo\nnew', null);
  });
});
