// @vitest-environment happy-dom
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceNodeRecord } from '../../../types';
import { I18nProvider } from '../../../i18n';

vi.mock('../NodeCanvasPreview', () => ({
  NodeCanvasPreview: ({ minHeight }: { minHeight?: number }) => (
    <div data-testid="node-canvas-preview" data-min-height={minHeight} />
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
  data: { content: '# Search & RSS' },
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
  it.each(['drawer', 'page'] as const)(
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
      <NodeDetailPanel node={NODE} workspaceId="workspace-1" mode="drawer" />,
    );

    const disclosures = Array.from(
      view.querySelectorAll<HTMLDetailsElement>('.node-detail-panel__disclosure'),
    );

    expect(disclosures).toHaveLength(2);
    expect(disclosures.every((item) => !item.open)).toBe(true);
    expect(disclosures[0]?.querySelector('summary')?.textContent).toContain('Relations');
    expect(disclosures[1]?.querySelector('summary')?.textContent).toContain('Info');
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
        relationCandidates={[{
          workspaceId: 'workspace-1',
          id: 'node-2',
          type: 'text',
          title: 'Recommendation System',
          tags: [],
          hasData: true,
          linkCount: 0,
        }]}
      />,
    );
    const addRelation = Array.from(view.querySelectorAll('button')).find((button) => button.textContent?.includes('Add relation'));
    if (!addRelation) throw new Error('Expected add relation button');

    act(() => { addRelation.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const input = view.querySelector<HTMLInputElement>('.node-relation-editor__form input');
    const targetTrigger = view.querySelector<HTMLButtonElement>('.node-relation-editor__target .ui-select__trigger');
    if (!input || !targetTrigger) throw new Error('Expected relation form');
    act(() => {
      // React tracks direct `input.value` assignments. Use the native setter
      // so this test follows the same event path as a real keystroke.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'challenges');
      input.dispatchEvent(new InputEvent('input', { bubbles: true }));
      targetTrigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
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
});
