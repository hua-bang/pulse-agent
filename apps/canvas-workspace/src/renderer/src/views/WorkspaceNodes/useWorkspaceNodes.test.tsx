// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceNodeRecord } from '../../types';
import { I18nProvider } from '../../i18n';
import { useWorkspaceNode } from './useWorkspaceNodes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  Reflect.deleteProperty(window, 'canvasWorkspace');
});

const NODE: WorkspaceNodeRecord = {
  schemaVersion: 1,
  id: 'node-1',
  type: 'file',
  title: 'Original',
  data: { content: '# Body' },
};

const Probe = () => {
  const { node, loading, missing } = useWorkspaceNode('workspace-1', 'node-1');
  return (
    <div data-testid="probe" data-loading={loading} data-missing={missing}>
      {node?.title ?? 'empty'}
    </div>
  );
};

describe('useWorkspaceNode', () => {
  it('keeps the current node mounted while a live-change refresh runs in the background', async () => {
    let onChange: ((event: { workspaceIds?: string[] }) => void) | undefined;
    let resolveRefresh: ((value: { ok: true; node: WorkspaceNodeRecord }) => void) | undefined;
    const pendingRefresh = new Promise<{ ok: true; node: WorkspaceNodeRecord }>((resolve) => {
      resolveRefresh = resolve;
    });
    const read = vi.fn()
      .mockResolvedValueOnce({ ok: true, node: NODE })
      .mockImplementationOnce(() => pendingRefresh);
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: {
        workspaceNodes: {
          read,
          onChange: (listener: typeof onChange) => {
            onChange = listener;
            return () => undefined;
          },
        },
      },
    });

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<I18nProvider><Probe /></I18nProvider>);
      await Promise.resolve();
    });

    const probe = () => host?.querySelector<HTMLElement>('[data-testid="probe"]');
    expect(probe()?.textContent).toBe('Original');
    expect(probe()?.dataset.loading).toBe('false');

    act(() => onChange?.({ workspaceIds: ['workspace-1'] }));
    expect(probe()?.textContent).toBe('Original');
    expect(probe()?.dataset.loading).toBe('false');

    await act(async () => {
      resolveRefresh?.({ ok: true, node: { ...NODE, title: 'Refreshed' } });
      await pendingRefresh;
    });
    expect(probe()?.textContent).toBe('Refreshed');
    expect(probe()?.dataset.loading).toBe('false');
  });

  // The read succeeds and simply carries no record. Without `missing`, hosts
  // cannot tell a deleted node from an unselected one.
  it('flags a node that no longer exists apart from a failed read', async () => {
    const read = vi.fn()
      .mockResolvedValueOnce({ ok: true, node: undefined })
      .mockResolvedValueOnce({ ok: false, error: 'Disk unavailable' });
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { workspaceNodes: { read } },
    });

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<I18nProvider><Probe /></I18nProvider>);
      await Promise.resolve();
    });

    const probe = () => host?.querySelector<HTMLElement>('[data-testid="probe"]');
    expect(probe()?.dataset.missing).toBe('true');
    expect(probe()?.textContent).toBe('empty');
  });
});
