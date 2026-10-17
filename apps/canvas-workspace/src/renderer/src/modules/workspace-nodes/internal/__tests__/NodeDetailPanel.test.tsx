// @vitest-environment happy-dom
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceNodeRecord } from '../../../../types';
import { I18nProvider } from '../../../../i18n';
import {
  FOCUS_NODE_ON_CANVAS_EVENT,
  nodeLinkHref,
  parseNodeLinkHref,
} from '../../../../utils/openNodeBridge';

vi.mock('../NodeCanvasPreview', () => ({
  NodeCanvasPreview: ({ minHeight, record }: { minHeight?: number; record: WorkspaceNodeRecord }) => (
    <div data-testid="node-canvas-preview" data-min-height={minHeight} data-node-type={record.type} />
  ),
}));

vi.mock('../NodeTagEditor', () => ({
  NodeTagEditor: () => <div data-testid="node-tag-editor" />,
}));

import { NodeDetailPanel } from '../NodeDetailPanel';

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
  title: 'Search & RSS',
  data: { content: 'Introduction' },
  properties: {
    tags: ['search'],
    source: 'research.md',
    aiSummary: 'RSS shifts the burden of organizing information back to the reader.',
  },
  links: [{
    relation: 'supports',
    target: { nodeId: 'node-2' },
    title: 'Recommendation System',
  }],
  updatedAt: 1_720_000_000_000,
};

function render(node: ReactNode): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(<I18nProvider>{node}</I18nProvider>);
  });
  return host;
}

describe('NodeDetailPanel', () => {
  it('gives compact file tabs the full body and keeps metadata in the inspector', () => {
    const view = render(<NodeDetailPanel node={NODE} workspaceId="workspace-1" mode="dock" compactDocument />);
    expect(view.querySelector('.node-detail-panel--document-dock')).not.toBeNull();
    expect(view.querySelector('[data-testid="node-canvas-preview"]')?.getAttribute('data-min-height')).toBe('0');
    expect(view.querySelector('.node-detail-panel__document-meta')).toBeNull();
    expect(view.querySelector('details')).toBeNull();
    // The document body opens with its own heading, so the dock hides the title field.
    expect(view.querySelector('.node-detail-panel__document-title')).toBeNull();
    act(() => (view.querySelector('button[aria-label="More"]') as HTMLButtonElement).click());
    expect(document.querySelector('.node-detail-panel__inspector [data-testid="node-tag-editor"]')).not.toBeNull();
    expect(document.querySelector('.node-detail-panel__inspector')?.textContent).toContain('RSS shifts');
    expect(document.querySelector('.node-detail-panel__inspector-actions')?.textContent).toContain('Open on canvas');
  });

  it('gives every compact dock tab a quiet heading and moves metadata into the inspector', () => {
    const view = render(
      <NodeDetailPanel node={{ ...NODE, type: 'text' }} workspaceId="workspace-1" mode="dock" compactDocument />,
    );
    expect(view.querySelector('.node-detail-panel--compact-dock')).not.toBeNull();
    expect(view.querySelector('.node-detail-panel--document-dock')).toBeNull();
    expect(view.querySelector('.node-detail-panel__document-title')?.textContent).toBe('Search & RSS');
    expect(view.querySelector('.node-detail-panel__document-meta')).toBeNull();
    expect(view.querySelector('.node-detail-panel__actions')).toBeNull();
    expect(view.querySelector('[data-testid="node-tag-editor"]')).toBeNull();
    expect(view.querySelector('details')).toBeNull();
  });

  it.each(['dock', 'page'] as const)(
    'keeps title, tags, and the real node preview in document order in %s mode',
    (mode) => {
      const view = render(
        <NodeDetailPanel node={NODE} workspaceId="workspace-1" mode={mode} />,
      );

      const title = view.querySelector('.node-detail-panel__document-title');
      const tags = view.querySelector('[data-testid="node-tag-editor"]');
      const preview = view.querySelector('[data-testid="node-canvas-preview"]');

      if (!title || !tags || !preview) throw new Error('Expected the shared document content');
      expect(title.textContent).toBe('Search & RSS');
      expect(title.compareDocumentPosition(tags) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(tags.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    },
  );

  it('places the type icon and tags together beneath the title', () => {
    const view = render(
      <NodeDetailPanel node={NODE} workspaceId="workspace-1" mode="page" />,
    );

    const metadata = view.querySelector('.node-detail-panel__document-meta');
    const type = metadata?.querySelector('.node-detail-panel__type');
    const tags = metadata?.querySelector('[data-testid="node-tag-editor"]');

    expect(metadata).not.toBeNull();
    expect(type?.querySelector('svg')).not.toBeNull();
    expect(type?.textContent).toContain('File');
    expect(tags).not.toBeNull();
  });

  it('keeps the node title independent from a leading H1 in the document body', () => {
    const view = render(
      <NodeDetailPanel
        node={{ ...NODE, title: 'Node title', data: { content: '# Body heading\n\nBody' } }}
        workspaceId="workspace-1"
        mode="dock"
      />,
    );

    expect(view.querySelector('.node-detail-panel__document-title')?.textContent).toBe('Node title');
    expect(view.querySelector('[data-testid="node-canvas-preview"]')).not.toBeNull();
  });

  it('keeps a legitimate title that happens to match a non-mindmap node type', () => {
    const view = render(
      <NodeDetailPanel node={{ ...NODE, title: 'File' }} workspaceId="workspace-1" mode="dock" />,
    );

    expect(view.querySelector('.node-detail-panel__document-title')?.textContent).toBe('File');
  });

  it('keeps only the confirmed AI summary in the page rail, without source or relations', () => {
    const view = render(
      <NodeDetailPanel node={NODE} workspaceId="workspace-1" mode="page" />,
    );

    const rail = view.querySelector('.node-detail-panel__context-rail');
    expect(rail?.textContent).toContain('RSS shifts the burden');
    expect(view.textContent).not.toContain('research.md');
    expect(view.textContent).not.toContain('Recommendation System');
  });

  it('drops the page rail and centers a single column when there is no AI summary', () => {
    const view = render(
      <NodeDetailPanel
        node={{ ...NODE, properties: { tags: ['search'] } }}
        workspaceId="workspace-1"
        mode="page"
      />,
    );

    expect(view.querySelector('.node-detail-panel__context-rail')).toBeNull();
    expect(view.querySelector('.node-detail-panel__layout--single')).not.toBeNull();
  });

  it.each(['page', 'dock'] as const)('shows tags but no Relations or Info sections in %s mode', (mode) => {
    const view = render(<NodeDetailPanel node={NODE} workspaceId="workspace-1" mode={mode} />);

    expect(view.querySelector('[data-testid="node-tag-editor"]')).not.toBeNull();
    expect(view.textContent).not.toContain('Relations');
    expect(view.textContent).not.toContain('Info');
    expect(view.querySelector('details')).toBeNull();
  });

  it.each(['iframe', 'mindmap'] as const)('gives %s nodes an immersive detail surface without document supplements', (type) => {
    const view = render(
      <NodeDetailPanel node={{ ...NODE, type }} workspaceId="workspace-1" mode="page" />,
    );

    expect(view.querySelector('.node-detail-panel--rich')).not.toBeNull();
    expect(view.querySelector('[data-testid="node-canvas-preview"]')?.getAttribute('data-node-type')).toBe(type);
    expect(view.querySelector('.node-detail-panel__context-rail')).toBeNull();
    expect(view.querySelector('[aria-label="Info"]')).toBeNull();
  });

  it('uses the mindmap root as its detail identity when the stored title is only a type placeholder', () => {
    const view = render(
      <NodeDetailPanel
        node={{
          ...NODE,
          type: 'mindmap',
          title: 'Mindmap',
          data: { root: { id: 'root', text: 'Growth strategy', children: [] }, layout: 'right' },
        }}
        workspaceId="workspace-1"
        mode="dock"
      />,
    );

    expect(view.querySelector('.node-detail-panel__document-title')?.textContent).toBe('Growth strategy');
  });

  it('writes an edited mindmap identity back to the root topic that supplies it', async () => {
    const mindmap = {
      ...NODE,
      type: 'mindmap',
      title: 'Mindmap',
      data: { root: { id: 'root', text: 'Growth strategy', children: [] }, layout: 'right' },
    } satisfies WorkspaceNodeRecord;
    const update = vi.fn(async (_workspaceId: string, _nodeId: string, patch: Partial<WorkspaceNodeRecord>) => ({
      ok: true,
      node: { ...mindmap, ...patch, data: { ...mindmap.data, ...patch.data } },
    }));
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { workspaceNodes: { update } },
    });
    const view = render(
      <NodeDetailPanel node={mindmap} workspaceId="workspace-1" mode="dock" />,
    );
    const title = view.querySelector<HTMLElement>('.node-detail-panel__document-title[contenteditable="true"]');
    if (!title) throw new Error('Expected an editable mindmap title');

    await act(async () => {
      title.textContent = 'Market strategy';
      title.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      await Promise.resolve();
    });

    expect(update).toHaveBeenCalledWith('workspace-1', 'node-1', {
      data: {
        ...mindmap.data,
        root: { id: 'root', text: 'Market strategy', children: [] },
      },
    });
  });

  it('edits the document title in place and writes it to the same node record', async () => {
    const update = vi.fn(async (_workspaceId: string, _nodeId: string, patch: Partial<WorkspaceNodeRecord>) => ({
      ok: true,
      node: { ...NODE, ...patch, updatedAt: NODE.updatedAt! + 1 },
    }));
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { workspaceNodes: { update } },
    });
    const onNodePatched = vi.fn();
    const view = render(
      <NodeDetailPanel
        node={NODE}
        workspaceId="workspace-1"
        mode="page"
        onNodePatched={onNodePatched}
      />,
    );
    const title = view.querySelector<HTMLElement>('.node-detail-panel__document-title[contenteditable="true"]');
    if (!title) throw new Error('Expected an editable document title');

    act(() => { title.textContent = 'A clearer title'; });
    await act(async () => {
      title.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      await Promise.resolve();
    });

    expect(update).toHaveBeenCalledWith('workspace-1', 'node-1', { title: 'A clearer title' });
    expect(onNodePatched).toHaveBeenCalledWith(expect.objectContaining({ title: 'A clearer title' }));
  });

  it('does not submit the title when Enter is confirming an IME candidate', () => {
    const update = vi.fn();
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { workspaceNodes: { update } },
    });
    const view = render(
      <NodeDetailPanel node={NODE} workspaceId="workspace-1" mode="page" />,
    );
    const title = view.querySelector<HTMLElement>('.node-detail-panel__document-title[contenteditable="true"]');
    if (!title) throw new Error('Expected an editable document title');
    title.focus();
    act(() => {
      title.textContent = '搜索输';
      title.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'Enter',
        isComposing: true,
      }));
    });

    expect(document.activeElement).toBe(title);
    expect(update).not.toHaveBeenCalled();
  });

  it('preserves a newer focused draft when an earlier title save resolves', async () => {
    let resolveFirst!: (value: { ok: true; node: WorkspaceNodeRecord }) => void;
    const update = vi.fn(() => new Promise<{ ok: true; node: WorkspaceNodeRecord }>((resolve) => {
      resolveFirst = resolve;
    }));
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { workspaceNodes: { update } },
    });
    const Harness = () => {
      const [node, setNode] = useState(NODE);
      return (
        <NodeDetailPanel
          node={node}
          workspaceId="workspace-1"
          mode="page"
          onNodePatched={setNode}
        />
      );
    };
    const view = render(<Harness />);
    const title = view.querySelector<HTMLElement>('.node-detail-panel__document-title[contenteditable="true"]');
    if (!title) throw new Error('Expected an editable document title');

    act(() => {
      title.focus();
      title.textContent = 'First save';
      title.dispatchEvent(new InputEvent('input', { bubbles: true }));
      title.blur();
      title.focus();
      title.textContent = 'Newer local draft';
      title.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    await act(async () => {
      resolveFirst({ ok: true, node: { ...NODE, title: 'First save', updatedAt: NODE.updatedAt! + 1 } });
      await Promise.resolve();
    });

    expect(title.textContent).toBe('Newer local draft');
  });

  // `workspace-node:read` answers a deleted node with ok + no record, which
  // used to render as "Select a node" — inside a tab still titled after it.
  it('reports a deleted node instead of the nothing-selected empty state', () => {
    const onClose = vi.fn();
    const view = render(
      <NodeDetailPanel node={null} workspaceId="workspace-1" mode="dock" missing onClose={onClose} />,
    );

    const empty = view.querySelector('.node-detail-panel__empty');
    expect(empty?.textContent).toContain('no longer exists');
    expect(empty?.textContent).not.toContain('Select a node');

    const close = Array.from(view.querySelectorAll('button')).find((button) => button.textContent === 'Close tab');
    if (!close) throw new Error('Expected a close action for a node that is gone');
    act(() => { close.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows a document skeleton while a node loads, not a bare line of text', () => {
    const view = render(<NodeDetailPanel node={null} workspaceId="workspace-1" mode="dock" loading />);

    expect(view.querySelector('.node-detail-panel__skeleton')).not.toBeNull();
    expect(view.querySelector('.node-detail-panel__empty')).toBeNull();
  });

  it('offers a retry when the node could not be read', () => {
    const onRetry = vi.fn();
    const view = render(
      <NodeDetailPanel node={null} workspaceId="workspace-1" mode="dock" error="Disk unavailable" onRetry={onRetry} />,
    );

    const retry = Array.from(view.querySelectorAll('button')).find((button) => button.textContent === 'Retry');
    if (!retry) throw new Error('Expected a retry button');
    act(() => { retry.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onRetry).toHaveBeenCalled();
  });

  it('asks the canvas to frame the node instead of stranding it in the list', () => {
    const listener = vi.fn();
    window.addEventListener(FOCUS_NODE_ON_CANVAS_EVENT, listener);
    const view = render(<NodeDetailPanel node={NODE} workspaceId="workspace-1" mode="dock" />);
    const openOnCanvas = view.querySelector<HTMLButtonElement>('[aria-label="Open on canvas"]');
    if (!openOnCanvas) throw new Error('Expected an open-on-canvas action');

    act(() => { openOnCanvas.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    expect((listener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      workspaceId: 'workspace-1',
      nodeId: 'node-1',
    });
    window.removeEventListener(FOCUS_NODE_ON_CANVAS_EVENT, listener);
  });

  it('copies a mention link that resolves back to this node', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const view = render(<NodeDetailPanel node={NODE} workspaceId="workspace-1" mode="dock" />);
    const copy = view.querySelector<HTMLButtonElement>('[aria-label="Copy node link"]');
    if (!copy) throw new Error('Expected a copy-link action');

    await act(async () => {
      copy.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const copied = nodeLinkHref('node-1', 'workspace-1');
    expect(writeText).toHaveBeenCalledWith(copied);
    expect(parseNodeLinkHref(copied)).toEqual({
      nodeId: 'node-1',
      workspaceId: 'workspace-1',
    });
  });

  it('keeps the confirmed AI summary readable in the dock, not only on the page', () => {
    const view = render(<NodeDetailPanel node={NODE} workspaceId="workspace-1" mode="dock" />);

    expect(view.querySelector('.node-detail-panel__ai-insight')?.textContent).toContain('RSS shifts the burden');
  });
});
