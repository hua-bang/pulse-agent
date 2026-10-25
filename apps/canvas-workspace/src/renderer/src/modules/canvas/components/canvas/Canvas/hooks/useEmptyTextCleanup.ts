import { useEffect, useRef, type MutableRefObject } from 'react';
import type { CanvasNode, TextNodeData } from '../../../../../../types';

// Only the wrapper markup an empty editor writes counts as blank. Stripping
// every `<...>` would also erase Markdown autolinks such as `<https://a.b>`.
const EMPTY_EDITOR_MARKUP = /<\/?(?:p|br|div|span)(?:\s[^>]*)?\/?>/gi;

const isBlankText = (node: CanvasNode): boolean => {
  if (node.type !== 'text') return false;
  const content = (node.data as TextNodeData).content ?? '';
  return content.replace(EMPTY_EDITOR_MARKUP, '').replace(/&nbsp;/g, ' ').trim() === '';
};

/**
 * Remove a text node the user leaves empty, as Figma and Excalidraw do. A text
 * node created and then abandoned otherwise stayed on the canvas as a bare
 * placeholder hint and showed up as "Text" in Layers, search, and mentions.
 * Only a node leaving the selection is checked, so empty nodes written by an
 * agent or restored by undo stay until the user selects and leaves them.
 */
export const useEmptyTextCleanup = ({
  selectedNodeIds,
  nodesRef,
  removeNodes,
}: {
  selectedNodeIds: string[];
  nodesRef: MutableRefObject<CanvasNode[]>;
  removeNodes: (ids: string[]) => void;
}) => {
  const previousRef = useRef<string[]>(selectedNodeIds);

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = selectedNodeIds;
    const stillSelected = new Set(selectedNodeIds);
    const left = new Set(previous.filter((id) => !stillSelected.has(id)));
    if (left.size === 0) return;
    const blank = nodesRef.current
      .filter((node) => left.has(node.id) && isBlankText(node))
      .map((node) => node.id);
    if (blank.length > 0) removeNodes(blank);
  }, [nodesRef, removeNodes, selectedNodeIds]);
};
