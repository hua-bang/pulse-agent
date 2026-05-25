import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type { MindmapNodeData, MindmapTopic } from '../../types';
import { genTopicId } from '../../utils/nodeFactory';
import {
  deleteTopic,
  findParent,
  findTopicPath,
  insertChild,
  isDescendant,
  layoutMindmap,
  moveTopic,
  setTopicText,
  toggleCollapsed,
  type DropTarget,
  type LaidOutTopic,
} from '../../utils/mindmapLayout';
import type { DropHint, KeyAction, MindmapNodeBodyProps } from './types';

export const useMindmapController = ({
  node,
  onUpdate,
  onSelectNode,
  onAutoResize,
  readOnly = false,
}: Pick<MindmapNodeBodyProps, 'node' | 'onUpdate' | 'onSelectNode' | 'onAutoResize' | 'readOnly'>) => {
  const data = (node.data ?? {}) as Partial<MindmapNodeData>;
  // Mindmap nodes can reach the renderer with `data.root` missing — e.g. a v2
  // storage workspace where the per-node file went absent and `assembleV2`
  // backfilled `data: {}`. Synthesize a stable empty root via a lazy
  // initializer so the hook doesn't crash on `root.id`, and any edit will
  // persist a real root through `applyRoot` → `onUpdate`.
  const [fallbackRoot] = useState<MindmapTopic>(() => ({
    id: genTopicId(),
    text: node.title?.trim() || 'Central topic',
    children: [],
  }));
  const root = data.root ?? fallbackRoot;
  const [selectedId, setSelectedId] = useState<string>(root.id);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reorder, setReorder] = useState<{
    sourceId: string;
    target: DropTarget | null;
  } | null>(null);
  const pendingFocusRef = useRef<string | null>(null);

  const layout = useMemo(() => layoutMindmap(root), [root]);
  const padding = 16;
  const wantedWidth = Math.max(140, Math.ceil(layout.width + padding * 2));
  const wantedHeight = Math.max(60, Math.ceil(layout.height + padding * 2));
  const viewportWidth = Math.max(0, node.width - padding * 2);
  const viewportHeight = Math.max(0, node.height - padding * 2);

  useEffect(() => {
    if (!readOnly && (node.width !== wantedWidth || node.height !== wantedHeight)) {
      onAutoResize(node.id, wantedWidth, wantedHeight);
    }
  }, [wantedWidth, wantedHeight, node.id, node.width, node.height, onAutoResize, readOnly]);

  useEffect(() => {
    const stillExists = findTopicPath(root, selectedId);
    if (!stillExists) setSelectedId(root.id);
  }, [root, selectedId]);

  useEffect(() => {
    if (!editingId || readOnly) return;
    const onMouseDownAnywhere = (e: MouseEvent) => {
      if (!(e.target instanceof Element)) return;
      const editingPill = e.target.closest('[data-topic-id]');
      if (editingPill?.getAttribute('data-topic-id') === editingId) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    };
    document.addEventListener('mousedown', onMouseDownAnywhere, true);
    return () => document.removeEventListener('mousedown', onMouseDownAnywhere, true);
  }, [editingId, readOnly]);

  const applyRoot = useCallback(
    (nextRoot: MindmapTopic) => {
      onUpdate(node.id, {
        data: {
          ...data,
          layout: data.layout ?? 'right',
          root: nextRoot,
          rev: (data.rev ?? 0) + 1,
        } satisfies MindmapNodeData,
      });
    },
    [data, node.id, onUpdate],
  );

  const foldPendingEdit = useCallback(
    (base: MindmapTopic, pendingEdit?: { topicId: string; text: string }) => {
      if (!pendingEdit) return base;
      const current = findTopicPath(base, pendingEdit.topicId)?.slice(-1)[0];
      if (!current || current.text === pendingEdit.text) return base;
      return setTopicText(base, pendingEdit.topicId, pendingEdit.text);
    },
    [],
  );

  const addChild = useCallback(
    (parentId: string, afterId?: string, pendingEdit?: { topicId: string; text: string }) => {
      const id = genTopicId();
      const topic: MindmapTopic = { id, text: '', children: [] };
      const baseRoot = foldPendingEdit(root, pendingEdit);
      applyRoot(insertChild(baseRoot, parentId, topic, afterId));
      pendingFocusRef.current = id;
    },
    [applyRoot, foldPendingEdit, root],
  );

  const addSibling = useCallback(
    (siblingId: string, pendingEdit?: { topicId: string; text: string }) => {
      if (siblingId === root.id) {
        addChild(root.id, undefined, pendingEdit);
        return;
      }
      const parent = findParent(root, siblingId);
      if (!parent) {
        const baseRoot = foldPendingEdit(root, pendingEdit);
        if (baseRoot !== root) applyRoot(baseRoot);
        return;
      }
      addChild(parent.id, siblingId, pendingEdit);
    },
    [addChild, applyRoot, foldPendingEdit, root],
  );

  const unindentTopic = useCallback(
    (topicId: string, pendingEdit?: { topicId: string; text: string }) => {
      const baseRoot = foldPendingEdit(root, pendingEdit);
      const bailWithTextOnly = () => {
        if (baseRoot !== root) applyRoot(baseRoot);
      };

      if (topicId === root.id) return bailWithTextOnly();
      const parent = findParent(baseRoot, topicId);
      if (!parent || parent.id === root.id) return bailWithTextOnly();
      const grandparent = findParent(baseRoot, parent.id);
      if (!grandparent) return bailWithTextOnly();

      const path = findTopicPath(baseRoot, topicId);
      const original = path?.[path.length - 1];
      if (!original) return bailWithTextOnly();

      const removed = deleteTopic(baseRoot, topicId);
      if (!removed) return bailWithTextOnly();
      const next = insertChild(removed.root, grandparent.id, original, parent.id);
      applyRoot(next);
      pendingFocusRef.current = topicId;
    },
    [applyRoot, foldPendingEdit, root],
  );

  const removeTopic = useCallback(
    (topicId: string) => {
      if (topicId === root.id) return;
      const result = deleteTopic(root, topicId);
      if (!result) return;
      applyRoot(result.root);
      setSelectedId(result.nextFocusId);
      setEditingId(null);
    },
    [applyRoot, root],
  );

  const renameTopic = useCallback(
    (topicId: string, text: string) => {
      if (findTopicPath(root, topicId)?.slice(-1)[0].text === text) return;
      applyRoot(setTopicText(root, topicId, text));
    },
    [applyRoot, root],
  );

  const toggleTopicCollapsed = useCallback(
    (topicId: string) => {
      applyRoot(toggleCollapsed(root, topicId));
    },
    [applyRoot, root],
  );

  const beginReorder = useCallback(
    (sourceId: string, startEvent: ReactMouseEvent) => {
      if (sourceId === root.id) return;
      const startX = startEvent.clientX;
      const startY = startEvent.clientY;
      const threshold = 5;
      let started = false;
      const dragRoot = root;

      const hitTest = (clientX: number, clientY: number): DropTarget | null => {
        const stack = document.elementsFromPoint(clientX, clientY);
        let pillEl: HTMLElement | null = null;
        for (const el of stack) {
          if (el instanceof HTMLElement && el.classList.contains('mindmap-topic')) {
            pillEl = el;
            break;
          }
        }
        if (!pillEl) return null;
        const targetId = pillEl.getAttribute('data-topic-id');
        if (!targetId || targetId === sourceId) return null;
        if (isDescendant(dragRoot, sourceId, targetId)) return null;

        const rect = pillEl.getBoundingClientRect();
        const relX = (clientX - rect.left) / Math.max(1, rect.width);
        const relY = (clientY - rect.top) / Math.max(1, rect.height);
        if (targetId === dragRoot.id) return { kind: 'child', parentId: targetId };
        if (relX > 0.66) return { kind: 'child', parentId: targetId };
        if (relY < 0.5) return { kind: 'before', anchorId: targetId };
        return { kind: 'after', anchorId: targetId };
      };

      const onMove = (e: MouseEvent) => {
        if (!started) {
          if (Math.hypot(e.clientX - startX, e.clientY - startY) < threshold) return;
          started = true;
          setReorder({ sourceId, target: null });
        }
        const target = hitTest(e.clientX, e.clientY);
        setReorder((s) => (s ? { ...s, target } : null));
      };

      const onUp = (e: MouseEvent) => {
        cleanup();
        if (!started) return;
        const target = hitTest(e.clientX, e.clientY);
        setReorder(null);
        if (!target) return;
        const next = moveTopic(dragRoot, sourceId, target);
        if (next) {
          applyRoot(next);
          setSelectedId(sourceId);
        }
      };

      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          cleanup();
          setReorder(null);
        }
      };

      function cleanup() {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('keydown', onKey);
      }

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      window.addEventListener('keydown', onKey);
    },
    [applyRoot, root],
  );

  useLayoutEffect(() => {
    const pendingId = pendingFocusRef.current;
    if (!pendingId) return;
    if (findTopicPath(root, pendingId)) {
      setSelectedId(pendingId);
      setEditingId(pendingId);
      pendingFocusRef.current = null;
    }
  }, [root]);

  const moveSelection = useCallback(
    (from: string, dir: 'up' | 'down' | 'left' | 'right') => {
      const current = layout.topics.find((t) => t.id === from);
      if (!current) return;
      const cx = current.x + current.width / 2;
      const cy = current.y + current.height / 2;

      let best: LaidOutTopic | null = null;
      let bestScore = Infinity;
      for (const candidate of layout.topics) {
        if (candidate.id === from) continue;
        const dx = candidate.x + candidate.width / 2 - cx;
        const dy = candidate.y + candidate.height / 2 - cy;
        if (dir === 'left' && dx >= 0) continue;
        if (dir === 'right' && dx <= 0) continue;
        if (dir === 'up' && dy >= 0) continue;
        if (dir === 'down' && dy <= 0) continue;
        const primary = dir === 'left' || dir === 'right' ? Math.abs(dx) : Math.abs(dy);
        const secondary = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
        const score = primary + secondary * 2;
        if (score < bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
      if (best) setSelectedId(best.id);
    },
    [layout.topics],
  );

  const selectTopic = useCallback((topicId: string) => {
    setSelectedId(topicId);
    onSelectNode(node.id);
  }, [node.id, onSelectNode]);

  const enterTopicEdit = useCallback((topicId: string) => {
    setSelectedId(topicId);
    setEditingId(topicId);
    onSelectNode(node.id);
  }, [node.id, onSelectNode]);

  const handleTopicKeyAction = useCallback((topicId: string, action: KeyAction) => {
    if (readOnly) return;
    const pendingEdit =
      (action.kind === 'addChild' || action.kind === 'addSibling' || action.kind === 'unindent') &&
      action.pendingText !== undefined
        ? { topicId, text: action.pendingText }
        : undefined;

    switch (action.kind) {
      case 'addChild':
        addChild(topicId, undefined, pendingEdit);
        break;
      case 'addSibling':
        addSibling(topicId, pendingEdit);
        break;
      case 'unindent':
        unindentTopic(topicId, pendingEdit);
        break;
      case 'delete':
        removeTopic(topicId);
        break;
      case 'toggle':
        toggleTopicCollapsed(topicId);
        break;
      case 'move':
        moveSelection(topicId, action.dir);
        break;
      case 'exit':
        setEditingId(null);
        break;
    }
  }, [addChild, addSibling, moveSelection, readOnly, removeTopic, toggleTopicCollapsed, unindentTopic]);

  const getDropHint = useCallback((topicId: string): DropHint => {
    if (!reorder?.target) return null;
    if (reorder.target.kind === 'child' && reorder.target.parentId === topicId) return 'child';
    if (reorder.target.kind === 'before' && reorder.target.anchorId === topicId) return 'before';
    if (reorder.target.kind === 'after' && reorder.target.anchorId === topicId) return 'after';
    return null;
  }, [reorder]);

  return {
    beginReorder,
    editingId,
    enterTopicEdit,
    getDropHint,
    handleTopicKeyAction,
    layout,
    padding,
    reorder,
    renameTopic,
    selectedId,
    selectTopic,
    setEditingId,
    toggleTopicCollapsed,
    viewportHeight,
    viewportWidth,
  };
};
