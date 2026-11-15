import { useCallback, type MutableRefObject } from 'react';
import type { CanvasEdge, CanvasNode, EdgeEndpoint, FileNodeData } from '../../../types';
import { createDefaultEdge } from '../model/edgeFactory';
import { createDefaultNode, genId } from '../../../utils/nodeFactory';
import { pasteOffset, pasteOffsetInView, type CanvasRect } from '../model/pasteOffset';
import { cloneEdgesForPaste, internalEdges } from '../model/pasteEdges';
import { withContainerDescendants } from '../../../utils/frameHierarchy';
import { cloneNodeData } from './cloneNodeData';
import { resizeGroupsToChildren } from '../model/resizeGroupsToChildren';

export interface AddNodeOptions {
  fileName?: string;
  fileContent?: string;
  nodePatch?: Partial<CanvasNode>;
  /** Connect a default edge from this endpoint to the new node. The node
   *  and the edge land in one history entry, so one undo removes both. */
  connectFrom?: EdgeEndpoint;
}

export interface PasteOptions {
  /** Edges to copy with the nodes; only those between pasted nodes are kept. */
  edges?: readonly CanvasEdge[];
  /** Visible canvas area. A paste that would land outside it is centred in it. */
  view?: CanvasRect | null;
}

interface ContentCommandOptions {
  canvasId: string;
  nodesRef: MutableRefObject<CanvasNode[]>;
  edgesRef: MutableRefObject<CanvasEdge[]>;
  applyNodes: (nodes: CanvasNode[], addToHistory?: boolean) => void;
  applyState: (patch: { nodes?: CanvasNode[]; edges?: CanvasEdge[] }, addToHistory?: boolean) => void;
}

const materializeFileNode = async ({
  applyNodes,
  canvasId,
  content,
  fileName,
  nodeId,
  nodesRef,
  writeContent,
}: Pick<ContentCommandOptions, 'applyNodes' | 'canvasId' | 'nodesRef'> & {
  content: string;
  fileName?: string;
  nodeId: string;
  writeContent: boolean;
}): Promise<void> => {
  const api = window.canvasWorkspace?.file;
  if (!api) return;
  const result = await api.createNote(canvasId, fileName);
  if (!result.ok || !result.filePath) return;
  if (writeContent) await api.write(result.filePath, content);
  const updated = nodesRef.current.map(node => node.id === nodeId
    ? {
        ...node,
        // Only a requested name becomes the title. The generated fallback
        // (`note-<timestamp>`) is a storage detail, so keep "Untitled".
        title: fileName ? result.fileName?.replace(/\.md$/, '') || node.title : node.title,
        data: {
          ...node.data,
          filePath: result.filePath ?? '',
          content: writeContent ? content : (node.data as FileNodeData).content,
          saved: true,
          modified: false,
        },
      }
    : node);
  applyNodes(updated, false);
};

export const useCanvasContentCommands = (options: ContentCommandOptions) => {
  const { applyNodes, applyState, canvasId, edgesRef, nodesRef } = options;

  const addNode = useCallback((
    type: CanvasNode['type'],
    x: number,
    y: number,
    addOptions?: AddNodeOptions,
  ) => {
    const baseNode = createDefaultNode(type, x, y);
    const nodePatch = addOptions?.nodePatch ?? {};
    const node: CanvasNode = {
      ...baseNode,
      ...nodePatch,
      data: nodePatch.data ? { ...baseNode.data, ...nodePatch.data } : baseNode.data,
      updatedAt: Date.now(),
    };
    if (node.type === 'file') {
      void materializeFileNode({
        applyNodes,
        canvasId,
        nodesRef,
        nodeId: node.id,
        fileName: addOptions?.fileName,
        content: addOptions?.fileContent ?? '',
        writeContent: typeof addOptions?.fileContent === 'string',
      });
    }
    if (addOptions?.connectFrom) {
      const edge = createDefaultEdge(addOptions.connectFrom, {
        kind: 'node',
        nodeId: node.id,
        anchor: 'auto',
      });
      applyState({ nodes: [...nodesRef.current, node], edges: [...edgesRef.current, edge] });
    } else {
      applyNodes([...nodesRef.current, node]);
    }
    void window.canvasWorkspace?.telemetry?.track('node_created', { type: node.type });
    return node;
  }, [applyNodes, applyState, canvasId, edgesRef, nodesRef]);

  const pasteNodes = useCallback((sources: CanvasNode[], pasteOptions: PasteOptions = {}) => {
    if (sources.length === 0) return [];
    const { x: offsetX, y: offsetY } = pasteOffsetInView(
      sources,
      pasteOffset(sources, nodesRef.current),
      pasteOptions.view,
    );
    const idMap = new Map(sources.map(source => [source.id, genId()] as const));
    const now = Date.now();
    const pasted = sources.map((source): CanvasNode => ({
      ...source,
      id: idMap.get(source.id) ?? genId(),
      x: source.x + offsetX,
      y: source.y + offsetY,
      data: cloneNodeData(source, idMap),
      updatedAt: now,
    }));
    pasted.forEach((node, index) => {
      const source = sources[index];
      if (node.type !== 'file' || source?.type !== 'file') return;
      void materializeFileNode({
        applyNodes,
        canvasId,
        nodesRef,
        nodeId: node.id,
        fileName: node.title,
        content: (source.data as FileNodeData).content,
        writeContent: true,
      });
    });
    // Nodes and their edges land in one history entry, so one undo removes
    // the whole paste.
    const edges = cloneEdgesForPaste(pasteOptions.edges ?? [], idMap, now);
    applyState({
      nodes: resizeGroupsToChildren([...nodesRef.current, ...pasted]),
      ...(edges.length > 0 ? { edges: [...edgesRef.current, ...edges] } : {}),
    });
    return pasted;
  }, [applyNodes, applyState, canvasId, edgesRef, nodesRef]);

  // One history entry for the whole selection, so a single undo removes
  // every copy.
  const duplicateNodes = useCallback((ids: readonly string[]) => {
    const idSet = new Set(ids);
    const selected = nodesRef.current.filter(node => idSet.has(node.id));
    const sources = withContainerDescendants(selected, nodesRef.current);
    const sourceIds = new Set(sources.map(node => node.id));
    return pasteNodes(sources, { edges: internalEdges(edgesRef.current, sourceIds) });
  }, [edgesRef, nodesRef, pasteNodes]);

  return { addNode, duplicateNodes, pasteNodes };
};
