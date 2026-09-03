import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import type { CanvasNode } from '../../../../../types';
import type { ResizeEdge } from '../../../../../hooks/useNodeResize';
import { isImeComposing } from '../../../../../utils/ime';
import { collectContainerDescendants } from '../../../../../utils/frameHierarchy';
import { useChatDeliveryNotifier } from '../../../../chat/delivery';
import { FULLSCREEN_NODE_TYPES } from './constants';
import type { CanvasNodeViewProps } from './types';
import {
  formatRelativeTime,
  getNodeClasses,
  getNodeWrapperStyle,
  getTextAutoSize,
  isCanvasPanGesture,
  sanitizeReferenceSourcePatch,
} from './utils';

const normalizePastedTitle = (value: string): string => (
  value
    .replace(/\r\n?|[\u2028\u2029]/g, '\n')
    .replace(/[ \t]*\n+[ \t]*/g, ' ')
);

const insertTextAtSelection = (target: HTMLSpanElement, value: string): void => {
  if (typeof document.execCommand === 'function'
    && document.execCommand('insertText', false, value)) {
    return;
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    target.append(document.createTextNode(value));
    return;
  }

  const range = selection.getRangeAt(0);
  if (!target.contains(range.commonAncestorContainer)) {
    target.append(document.createTextNode(value));
    return;
  }

  range.deleteContents();
  const textNode = document.createTextNode(value);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
};

export const useCanvasNodeViewModel = ({
  embedded,
  dragOffset,
  focusState,
  getAllNodes,
  isAgentEdited,
  isDragging,
  isFullscreen,
  isHighlighted,
  isResizing,
  isSelected,
  renameToken,
  node,
  onDragStart,
  onFocus,
  onOpenReferenceSource,
  onReference,
  onAddToChat,
  onAddToCanvas,
  onRemove,
  onResizeStart,
  onSelect,
  onToggleFullscreen,
  onUngroupSelectedGroups,
  onUpdate,
  onUpdateReferenceSource,
  readOnly,
}: Pick<
  Required<CanvasNodeViewProps>,
  | 'embedded'
  | 'focusState'
  | 'isFullscreen'
  | 'readOnly'
> & Pick<
  CanvasNodeViewProps,
  | 'getAllNodes'
  | 'isAgentEdited'
  | 'isDragging'
  | 'isHighlighted'
  | 'isResizing'
  | 'isSelected'
  | 'renameToken'
  | 'node'
  | 'onDragStart'
  | 'onFocus'
  | 'onOpenReferenceSource'
  | 'onReference'
  | 'onAddToChat'
  | 'onAddToCanvas'
  | 'onRemove'
  | 'onResizeStart'
  | 'onSelect'
  | 'onToggleFullscreen'
  | 'onUngroupSelectedGroups'
  | 'onUpdate'
  | 'onUpdateReferenceSource'
  | 'dragOffset'
>) => {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [, setTick] = useState(0);
  const titleRef = useRef<HTMLSpanElement>(null);
  const notifyChatDelivery = useChatDeliveryNotifier();

  useEffect(() => {
    if (!node.updatedAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [node.updatedAt]);

  const handleHeaderMouseDown = useCallback(
    (e: MouseEvent) => {
      if (readOnly) return;
      const hasMods = e.shiftKey || e.metaKey || e.ctrlKey;
      if (!isSelected && !hasMods) onSelect(node.id);
      onDragStart(e, node);
    },
    [onSelect, onDragStart, node, isSelected, readOnly],
  );

  const handleNodeClick = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      if (readOnly) return;
      onSelect(node.id, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
    },
    [onSelect, node.id, readOnly],
  );

  const handleClose = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      if (readOnly) return;
      onRemove(node.id);
    },
    [onRemove, node.id, readOnly],
  );

  const handleFocus = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      onFocus(node);
    },
    [onFocus, node],
  );

  const handleToggleFullscreen = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      onToggleFullscreen?.(node.id);
    },
    [onToggleFullscreen, node.id],
  );

  const handleReference = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      onReference?.(node.id);
    },
    [onReference, node.id],
  );

  const handleAddToChat = useCallback(
    async (e: MouseEvent) => {
      e.stopPropagation();
      if (!onAddToChat) return;
      try {
        const receipt = await onAddToChat(node.id);
        if (receipt) notifyChatDelivery(receipt, node.title);
      } catch (error) {
        notifyChatDelivery({
          status: 'failed',
          target: null,
          error: error instanceof Error ? error.message : String(error),
        }, node.title);
      }
    },
    [node.id, node.title, notifyChatDelivery, onAddToChat],
  );

  const handleAddToCanvas = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      onAddToCanvas?.(node.id);
    },
    [onAddToCanvas, node.id],
  );

  const handleOpenReferenceSource = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      onOpenReferenceSource?.(node);
    },
    [node, onOpenReferenceSource],
  );

  const handleUngroup = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      if (readOnly) return;
      onUngroupSelectedGroups?.();
    },
    [onUngroupSelectedGroups, readOnly],
  );

  const handleNodeBodyMouseDown = useCallback((e: MouseEvent) => {
    if (isCanvasPanGesture(e)) return;
    e.stopPropagation();
  }, []);

  const handleTitleBlur = useCallback(
    (e: FocusEvent<HTMLSpanElement>) => {
      if (readOnly) {
        setIsEditingTitle(false);
        return;
      }
      const newTitle = e.currentTarget.textContent?.trim();
      if (!newTitle) {
        // `contentEditable` mutates the DOM outside React. Because the
        // persisted `node.title` prop did not change, React has no diff that
        // would restore a cleared title when editing ends.
        e.currentTarget.textContent = node.title;
      } else if (newTitle !== node.title) {
        onUpdate(node.id, { title: newTitle });
      }
      setIsEditingTitle(false);
    },
    [onUpdate, node.id, node.title, readOnly],
  );

  const beginTitleEditing = useCallback(() => {
    if (readOnly) return;
    setIsEditingTitle(true);
    requestAnimationFrame(() => {
      if (!titleRef.current) return;
      titleRef.current.focus();
      const range = document.createRange();
      range.selectNodeContents(titleRef.current);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
  }, [readOnly]);

  // Canvas-level rename (Enter / F2 on the selection). Selection and DOM
  // focus are separate in a canvas — a mouse-selected node holds no focus —
  // so the shortcut cannot simply rely on the title span's own key handling.
  useEffect(() => {
    if (!renameToken) return;
    beginTitleEditing();
  }, [renameToken, beginTitleEditing]);

  const handleTitleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLSpanElement>) => {
      if (!isEditingTitle) {
        if (!readOnly && (e.key === 'Enter' || e.key === 'F2')) {
          e.preventDefault();
          e.stopPropagation();
          beginTitleEditing();
        }
        return;
      }

      // Enter/Escape during IME composition confirm/dismiss the candidate
      // text — committing or reverting the title there would eat the input.
      if (isImeComposing(e)) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        titleRef.current?.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (titleRef.current) titleRef.current.textContent = node.title;
        titleRef.current?.blur();
      }
    },
    [beginTitleEditing, isEditingTitle, node.title, readOnly],
  );

  const handleTitlePaste = useCallback(
    (e: ClipboardEvent<HTMLSpanElement>) => {
      if (!isEditingTitle || readOnly) return;
      e.preventDefault();
      e.stopPropagation();
      insertTextAtSelection(
        e.currentTarget,
        normalizePastedTitle(e.clipboardData.getData('text/plain')),
      );
    },
    [isEditingTitle, readOnly],
  );

  const handleTitleDoubleClick = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      beginTitleEditing();
    },
    [beginTitleEditing],
  );

  const makeResizeHandler = useCallback(
    (edge: ResizeEdge) => (e: MouseEvent) => {
      if (node.type === 'text') {
        onResizeStart(e, node.id, node.width, node.height, edge, 40, 28);
        return;
      }
      onResizeStart(e, node.id, node.width, node.height, edge);
    },
    [onResizeStart, node.id, node.type, node.width, node.height],
  );

  const handleReferenceSourceUpdate = useCallback(
    (_sourceId: string, patch: Partial<CanvasNode>) => {
      const sanitized = sanitizeReferenceSourcePatch(patch);
      if (Object.keys(sanitized).length === 0) return;
      onUpdateReferenceSource?.(node, sanitized);
    },
    [node, onUpdateReferenceSource],
  );

  const textAutoSize = getTextAutoSize(node);
  const containerDescendantCount = (node.type === 'group' || node.type === 'frame') && getAllNodes
    ? collectContainerDescendants(node.id, getAllNodes()).length
    : 0;

  return {
    classes: getNodeClasses({
      embedded,
      focusState,
      isAgentEdited,
      isDragging,
      isFullscreen,
      isHighlighted,
      isResizing,
      isSelected,
      node,
      readOnly,
      textAutoSize,
    }),
    fullscreenButtonEnabled: FULLSCREEN_NODE_TYPES.has(node.type) && !!onToggleFullscreen,
    containerDescendantCount,
    handleClose,
    handleFocus,
    handleHeaderMouseDown,
    handleNodeBodyMouseDown,
    handleNodeClick,
    handleOpenReferenceSource,
    handleReference,
    handleAddToChat,
    handleAddToCanvas,
    handleReferenceSourceUpdate,
    handleTitleBlur,
    handleTitleDoubleClick,
    handleTitleKeyDown,
    handleTitlePaste,
    handleToggleFullscreen,
    handleUngroup,
    isEditingTitle,
    makeResizeHandler,
    relativeTime: node.updatedAt ? formatRelativeTime(node.updatedAt) : null,
    titleRef,
    // Caller (CanvasSurface) already gates dragOffset to null for any node
    // that isn't the one currently being dragged — a single source of
    // truth for that gating, same as `isDragging` itself.
    wrapperStyle: getNodeWrapperStyle(node, dragOffset),
  };
};
