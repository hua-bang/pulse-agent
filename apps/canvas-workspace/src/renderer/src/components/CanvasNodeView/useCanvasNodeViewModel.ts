import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import type { CanvasNode, TextNodeData } from '../../types';
import type { ResizeEdge } from '../../hooks/useNodeResize';
import { collectContainerDescendants } from '../../utils/frameHierarchy';
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

export const useCanvasNodeViewModel = ({
  embedded,
  focusState,
  getAllNodes,
  isAgentEdited,
  isDragging,
  isFullscreen,
  isHighlighted,
  isResizing,
  isSelected,
  node,
  onDragStart,
  onFocus,
  onOpenReferenceSource,
  onReference,
  onAddToChat,
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
  | 'node'
  | 'onDragStart'
  | 'onFocus'
  | 'onOpenReferenceSource'
  | 'onReference'
  | 'onAddToChat'
  | 'onRemove'
  | 'onResizeStart'
  | 'onSelect'
  | 'onToggleFullscreen'
  | 'onUngroupSelectedGroups'
  | 'onUpdate'
  | 'onUpdateReferenceSource'
>) => {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [, setTick] = useState(0);
  const titleRef = useRef<HTMLSpanElement>(null);

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
      if (readOnly) return;
      onReference?.(node.id);
    },
    [onReference, node.id, readOnly],
  );

  const handleAddToChat = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      onAddToChat?.(node.id);
    },
    [onAddToChat, node.id],
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
      if (newTitle && newTitle !== node.title) {
        onUpdate(node.id, { title: newTitle });
      }
      setIsEditingTitle(false);
    },
    [onUpdate, node.id, node.title, readOnly],
  );

  const handleTitleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLSpanElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        titleRef.current?.blur();
      } else if (e.key === 'Escape') {
        if (titleRef.current) titleRef.current.textContent = node.title;
        titleRef.current?.blur();
      }
    },
    [node.title],
  );

  const handleTitleDoubleClick = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      if (readOnly) return;
      setIsEditingTitle(true);
      requestAnimationFrame(() => {
        if (titleRef.current) {
          titleRef.current.focus();
          const range = document.createRange();
          range.selectNodeContents(titleRef.current);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      });
    },
    [readOnly],
  );

  const makeResizeHandler = useCallback(
    (edge: ResizeEdge) => (e: MouseEvent) => {
      if (node.type === 'text') {
        const data = node.data as TextNodeData;
        if (data.autoSize !== false) {
          onUpdate(node.id, { data: { ...data, autoSize: false } });
        }
        onResizeStart(e, node.id, node.width, node.height, edge, 40, 28);
        return;
      }
      onResizeStart(e, node.id, node.width, node.height, edge);
    },
    [onResizeStart, onUpdate, node.id, node.type, node.width, node.height, node.data],
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
  const groupDescendantCount = node.type === 'group' && getAllNodes
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
    groupDescendantCount,
    handleClose,
    handleFocus,
    handleHeaderMouseDown,
    handleNodeBodyMouseDown,
    handleNodeClick,
    handleOpenReferenceSource,
    handleReference,
    handleAddToChat,
    handleReferenceSourceUpdate,
    handleTitleBlur,
    handleTitleDoubleClick,
    handleTitleKeyDown,
    handleToggleFullscreen,
    handleUngroup,
    isEditingTitle,
    makeResizeHandler,
    relativeTime: node.updatedAt ? formatRelativeTime(node.updatedAt) : null,
    titleRef,
    wrapperStyle: getNodeWrapperStyle(node),
  };
};
