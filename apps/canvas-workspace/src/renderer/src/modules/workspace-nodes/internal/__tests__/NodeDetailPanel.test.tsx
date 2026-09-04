// @vitest-environment happy-dom
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceNodeListItem, WorkspaceNodeRecord } from '../../../../types';
import { I18nProvider } from '../../../../i18n';
import {
  FOCUS_NODE_ON_CANVAS_EVENT,
  OPEN_NODE_EVENT,
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

const RELATION_CANDIDATE: WorkspaceNodeListItem = {
  workspaceId: 'workspace-1',
  id: 'node-2',
  type: 'text',
  title: 'Recommendation System',
  tags: [],
  hasData: true,
  linkCount: 0,
};

/** React tracks direct `input.value` assignments; go through the native
 *  setter so a test follows the same event path as a real keystroke. */
function setInputValue(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

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

  it('shows source, relations, and confirmed AI insight in the page context rail', () => {
    const view = render(
      <NodeDetailPanel node={NODE} workspaceId="workspace-1" mode="page" />,
    );

    const rail = view.querySelector('.node-detail-panel__context-rail');
    expect(rail?.textContent).toContain('research.md');
    expect(rail?.textContent).toContain('Recommendation System');
    expect(rail?.textContent).toContain('RSS shifts the burden');
  });

  it('renders Relations and Info as collapsed disclosures by default', () => {
    const view = render(
      <NodeDetailPanel node={NODE} workspaceId="workspace-1" mode="dock" />,
    );

    const disclosures = Array.from(
      view.querySelectorAll<HTMLDetailsElement>('.node-detail-panel__disclosure'),
    );

    expect(disclosures).toHaveLength(2);
    expect(disclosures.every((item) => !item.open)).toBe(true);
    expect(disclosures[0]?.querySelector('summary')?.textContent).toContain('Relations');
    expect(disclosures[1]?.querySelector('summary')?.textContent).toContain('Info');
  });

  it.each(['iframe', 'mindmap'] as const)('gives %s nodes an immersive detail surface without document supplements', (type) => {
    const view = render(
      <NodeDetailPanel node={{ ...NODE, type }} workspaceId="workspace-1" mode="page" />,
    );

    expect(view.querySelector('.node-detail-panel--rich')).not.toBeNull();
    expect(view.querySelector('[data-testid="node-canvas-preview"]')?.getAttribute('data-node-type')).toBe(type);
    expect(view.querySelector('.node-detail-panel__supplementary')).toBeNull();
    expect(view.querySelector('.node-detail-panel__context-rail')).toBeNull();
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

  it('keeps rich-node metadata available from a compact inspector instead of appending it to the surface', () => {
    const view = render(
      <NodeDetailPanel node={{ ...NODE, type: 'iframe' }} workspaceId="workspace-1" mode="dock" />,
    );
    const info = view.querySelector<HTMLButtonElement>('[aria-label="Info"]');
    if (!info) throw new Error('Expected an Info inspector action');

    info.focus();
    act(() => { info.click(); });

    const inspector = document.querySelector('.node-detail-panel__inspector');
    expect(inspector?.textContent).toContain('research.md');
    expect(inspector?.textContent).toContain('Recommendation System');
    expect(view.querySelector('.node-detail-panel__supplementary')).toBeNull();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(document.activeElement).toBe(info);

    const close = inspector?.querySelector<HTMLButtonElement>('[aria-label="Close"]');
    close?.focus();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('.node-detail-panel__inspector')).toBeNull();
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

  it('adds an open-ended relation without restricting the stored relation vocabulary', async () => {
    const update = vi.fn(async (_workspaceId: string, _nodeId: string, patch: Partial<WorkspaceNodeRecord>) => ({
      ok: true,
      node: { ...NODE, ...patch, updatedAt: NODE.updatedAt! + 1 },
    }));
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { workspaceNodes: { update } },
    });
    const view = render(
      <NodeDetailPanel
        node={{ ...NODE, links: [] }}
        workspaceId="workspace-1"
        relationCandidates={[RELATION_CANDIDATE]}
      />,
    );
    const addRelation = Array.from(view.querySelectorAll('button')).find((button) => button.textContent?.includes('Add relation'));
    if (!addRelation) throw new Error('Expected add relation button');

    act(() => { addRelation.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const [relationInput] = Array.from(view.querySelectorAll<HTMLInputElement>('.node-relation-editor__form input'));
    if (!relationInput) throw new Error('Expected relation form');
    act(() => { setInputValue(relationInput, 'challenges'); });
    const target = Array.from(view.querySelectorAll<HTMLButtonElement>('[role="option"]')).find((option) => option.textContent?.includes('Recommendation System'));
    if (!target) throw new Error('Expected relation target option');
    act(() => { target.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const save = Array.from(view.querySelectorAll('button')).find((button) => button.textContent === 'Add');
    if (!save) throw new Error('Expected relation save button');
    await act(async () => {
      save.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(update).toHaveBeenCalledWith('workspace-1', 'node-1', {
      links: [{
        relation: 'challenges',
        target: { nodeId: 'node-2' },
        title: 'Recommendation System',
      }],
    });
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

  it('opens a related node from its relation row', () => {
    const listener = vi.fn();
    window.addEventListener(OPEN_NODE_EVENT, listener);
    const view = render(<NodeDetailPanel node={NODE} workspaceId="workspace-1" mode="page" />);
    const target = view.querySelector<HTMLButtonElement>('.node-relation-editor__target-link');
    if (!target) throw new Error('Expected the relation target to be reachable');

    act(() => { target.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    expect((listener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      workspaceId: 'workspace-1',
      nodeId: 'node-2',
    });
    window.removeEventListener(OPEN_NODE_EVENT, listener);
  });

  // ui/Select has no search, so picking out of a large workspace meant
  // scrolling an unfiltered list of every node.
  it('filters relation targets by what the user types', () => {
    const candidates = [
      RELATION_CANDIDATE,
      { ...RELATION_CANDIDATE, id: 'node-3', title: 'Search & RSS notes' },
      { ...RELATION_CANDIDATE, id: 'node-4', title: 'Unrelated ledger' },
    ];
    const view = render(
      <NodeDetailPanel
        node={{ ...NODE, links: [] }}
        workspaceId="workspace-1"
        relationCandidates={candidates}
      />,
    );
    const addRelation = Array.from(view.querySelectorAll('button')).find((button) => button.textContent?.includes('Add relation'));
    if (!addRelation) throw new Error('Expected add relation button');
    act(() => { addRelation.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    expect(view.querySelectorAll('.node-relation-editor__option')).toHaveLength(3);

    const targetInput = Array.from(view.querySelectorAll<HTMLInputElement>('.node-relation-editor__form input'))[1];
    if (!targetInput) throw new Error('Expected the target combobox');
    act(() => { setInputValue(targetInput, 'ledger'); });

    const options = Array.from(view.querySelectorAll('.node-relation-editor__option'));
    expect(options).toHaveLength(1);
    expect(options[0]?.textContent).toBe('Unrelated ledger');
  });
});
