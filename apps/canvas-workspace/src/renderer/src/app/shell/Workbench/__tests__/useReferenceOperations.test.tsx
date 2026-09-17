// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useReferenceOperations } from '../useReferenceOperations';
import { createDefaultNode } from '../../../../utils/nodeFactory';
import type { CanvasNode } from '../../../../types';
import type { NodeReferenceEntry } from '../../../../shared/reference/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const originalApi = window.canvasWorkspace;
let root: Root;
let current: ReturnType<typeof useReferenceOperations>;
let options: Parameters<typeof useReferenceOperations>[0];
let source: CanvasNode;
const entry: NodeReferenceEntry = {
  kind: 'node', workspaceId: 'source', nodeId: 'note', titleSnapshot: 'Old title',
  typeSnapshot: 'text', workspaceNameSnapshot: 'Old workspace',
};
const load = vi.fn();
const save = vi.fn();
const patchNodeSnapshot = vi.fn((_workspaceId: string, _nodeId: string, _patch: Partial<CanvasNode>): CanvasNode[] | undefined => []);
const ensureWorkspaceNodesLoaded = vi.fn();
const setReferenceDrawerOpen = vi.fn();
const peekNode = vi.fn();
const Harness = () => {
  current = useReferenceOperations(options);
  return null;
};
const render = () => act(() => root.render(<Harness />));

beforeEach(() => {
  vi.clearAllMocks();
  source = { ...createDefaultNode('text', 10, 20), id: 'note', title: 'Live title', width: 250, height: 140 };
  options = {
    allNodes: { source: [source] }, workspaces: [{ id: 'source', name: 'Source workspace' }],
    mountedWorkspaceIds: new Set(), patchNodeSnapshot, ensureWorkspaceNodesLoaded, setReferenceDrawerOpen, peekNode,
  };
  load.mockResolvedValue({ ok: true, data: { nodes: [], edges: [{ id: 'edge' }], transform: { x: 4, y: 5, scale: 2 } } });
  save.mockResolvedValue({ ok: true });
  Object.defineProperty(window, 'canvasWorkspace', { configurable: true, value: { store: { load, save } } });
  root = createRoot(document.createElement('div'));
  render();
});
afterEach(() => {
  act(() => root.unmount());
  Object.defineProperty(window, 'canvasWorkspace', { configurable: true, value: originalApi });
});

describe('reference operations', () => {
  it('loads the source for placement and uses live data, with entry snapshots as the missing-source fallback', () => {
    act(() => current.addReferenceToCanvas(entry));
    expect(ensureWorkspaceNodesLoaded).toHaveBeenCalledWith('source');
    expect(setReferenceDrawerOpen).toHaveBeenCalledWith(false);
    expect(current.referencePlacementRequest).toEqual(entry);
    expect(current.createReferenceNodeFromEntry(entry, 30, 40)).toMatchObject({
      type: 'reference', x: 30, y: 40, width: 250, height: 140,
      ref: { kind: 'workspace-node', workspaceId: 'source', nodeId: 'note' },
      data: { titleSnapshot: 'Live title', workspaceNameSnapshot: 'Source workspace', typeSnapshot: 'text' },
    });
    options = { ...options, allNodes: {}, workspaces: [] };
    render();
    expect(current.createReferenceNodeFromEntry(entry, 30, 40)?.data).toMatchObject({
      titleSnapshot: 'Old title', workspaceNameSnapshot: 'Old workspace', typeSnapshot: 'text',
    });
    act(() => current.consumeReferencePlacementRequest());
    expect(current.referencePlacementRequest).toBeNull();
  });

  it('pastes cross-workspace references with source identity and offsets, skipping unsupported nodes', () => {
    const frame = createDefaultNode('frame', 0, 0);
    const clipboard = { sourceWorkspaceId: 'source', nodes: [source, frame] };
    expect(current.pasteReferencesIntoCanvas('source', clipboard)).toEqual([]);
    const pasted = current.pasteReferencesIntoCanvas('target', clipboard);
    expect(pasted).toHaveLength(1);
    expect(pasted[0]).toMatchObject({
      type: 'reference', x: 34, y: 44, width: 250, height: 140,
      ref: { kind: 'workspace-node', workspaceId: 'source', nodeId: 'note' },
    });
    expect(pasted[0].id).not.toBe(source.id);
  });

  it('preserves missing-source snapshots when copying an existing reference and resolves live sources when available', () => {
    const reference = current.createReferenceNodeFromEntry(entry, 30, 40)!;
    const clipboard = { sourceWorkspaceId: 'middle', nodes: [reference] };
    expect(current.resolveReferenceNode(reference)).toEqual({ node: source, workspaceName: 'Source workspace' });
    current.handleOpenReferenceSource(reference);
    expect(peekNode).toHaveBeenCalledWith('source', 'note');
    options = { ...options, allNodes: {} };
    render();
    const pasted = current.pasteReferencesIntoCanvas('target', clipboard);
    expect(pasted).toHaveLength(1);
    expect(pasted[0]).toMatchObject({ x: 54, y: 64, ref: reference.ref, data: reference.data });
  });

  it('routes mounted-source edits through requests, ignores stale completions, and does not save directly', () => {
    options = { ...options, mountedWorkspaceIds: new Set(['source']) };
    render();
    const reference = current.createReferenceNodeFromEntry(entry, 0, 0)!;
    act(() => current.updateReferenceSourceNode(reference, { title: 'One' }));
    const first = current.nodePatchRequest!.requestId;
    act(() => current.updateReferenceSourceNode(reference, { title: 'Two' }));
    const second = current.nodePatchRequest!.requestId;
    expect(second).toBeGreaterThan(first);
    act(() => current.completeNodePatch(first));
    expect(current.nodePatchRequest).toMatchObject({ requestId: second, patch: { title: 'Two' } });
    act(() => current.completeNodePatch(second));
    expect(current.nodePatchRequest).toBeUndefined();
    expect(patchNodeSnapshot).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('persists an unmounted source patch while retaining edges and viewport state', async () => {
    const reference = current.createReferenceNodeFromEntry(entry, 0, 0)!;
    const nodes = [{ ...source, title: 'Updated' }];
    patchNodeSnapshot.mockReturnValue(nodes);
    await act(async () => current.updateReferenceSourceNode(reference, { title: 'Updated' }));
    expect(patchNodeSnapshot).toHaveBeenCalledWith('source', 'note', { title: 'Updated' });
    expect(save).toHaveBeenCalledWith('source', expect.objectContaining({
      nodes, edges: [{ id: 'edge' }], transform: { x: 4, y: 5, scale: 2 },
    }));
    expect(current.nodePatchRequest).toBeUndefined();
  });
});
