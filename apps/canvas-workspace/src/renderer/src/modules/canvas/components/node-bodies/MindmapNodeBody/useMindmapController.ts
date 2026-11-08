import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { MindmapNodeData, MindmapTopic } from '../../../../../types';
import { genTopicId } from '../../../../../../../shared/canvas-node-defaults';
import {
  deleteTopic,
  ensureTopicChildren,
  findParent,
  findTopicPath,
  insertChild,
  setTopicText,
  toggleCollapsed,
} from '../../../mindmap/tree';
import { layoutMindmap, type LaidOutTopic, type MindmapLayout } from '../../../mindmap/layout';
import type { DropHint, KeyAction, MindmapNodeBodyProps } from './types';
import {
  startMindmapDrag,
  type MindmapReorderState,
} from './mindmapDrag';

const MINDMAP_PADDING = 16;
const nodeSizeFor = (layout: MindmapLayout) => ({
  width: Math.max(140, Math.ceil(layout.width + MINDMAP_PADDING * 2)),
  height: Math.max(60, Math.ceil(layout.height + MINDMAP_PADDING * 2)),
});

export const useMindmapController = ({
  node,
  onUpdate,
  onSelectNode,
  onAutoResize,
  onMergeTopic,
  onSplitTopic,
  readOnly = false,
}: Pick<
  MindmapNodeBodyProps,
  | 'node'
  | 'onUpdate'
  | 'onSelectNode'
  | 'onAutoResize'
  | 'onMergeTopic'
  | 'onSplitTopic'
  | 'readOnly'
>) => {
  const data = node.data as MindmapNodeData;
  const root = useMemo(() => ensureTopicChildren(data.root), [data.root]);
  const [selectedId, setSelectedId] = useState<string>(root.id);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingInitialInput, setEditingInitialInput] = useState<string | undefined>();
  const [reorder, setReorder] = useState<MindmapReorderState | null>(null);
  const pendingFocusRef = useRef<string | null>(null);
  // A topic made by Enter, Tab, or "+" that has not been typed into yet.
  // Leaving it empty cancels it instead of keeping an "Untitled" topic.
  const freshTopicRef = useRef<string | null>(null);
  // Text typed into the editing topic, so layout makes room as you type.
  const [draft, setDraft] = useState<{ id: string; text: string } | null>(null);

  const layout = useMemo(
    () => layoutMindmap(root, { draft: editingId && draft?.id === editingId ? draft : null }),
    [root, draft, editingId],
  );
  const padding = MINDMAP_PADDING;
  const { width: wantedWidth, height: wantedHeight } = nodeSizeFor(layout);
  const viewportWidth = Math.max(0, node.width - padding * 2);
  const viewportHeight = Math.max(0, node.height - padding * 2);

  // Keep the root still on the canvas. The root is centered on the tree's
  // height, so growing or shrinking a branch moves it inside the node;
  // shift the node by the same amount the other way. When the node itself
  // moved (drag, undo restoring an old snapshot), accept the new spot.
  const rootY = layout.topics[0]?.y ?? 0;
  const anchorRef = useRef({ nodeY: node.y, rootY });
  useEffect(() => {
    const prev = anchorRef.current;
    const dy = node.y === prev.nodeY ? rootY - prev.rootY : 0;
    const nextY = node.y - dy;
    anchorRef.current = { nodeY: nextY, rootY };
    if (readOnly) return;
    if (dy !== 0 || node.width !== wantedWidth || node.height !== wantedHeight) {
      onAutoResize(node.id, wantedWidth, wantedHeight, node.x, nextY);
    }
  }, [rootY, wantedWidth, wantedHeight, node.id, node.x, node.y, node.width, node.height, onAutoResize, readOnly]);

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
      // Size and anchor the node in the same update as the tree, so the
      // undo entry pairs this tree with its geometry.
      const nextLayout = layoutMindmap(nextRoot);
      const dy = (nextLayout.topics[0]?.y ?? 0) - (layout.topics[0]?.y ?? 0);
      onUpdate(node.id, {
        data: {
          ...data,
          root: nextRoot,
          rev: (data.rev ?? 0) + 1,
        },
        ...(readOnly ? {} : { y: node.y - dy, ...nodeSizeFor(nextLayout) }),
      });
    },
    [data, layout.topics, node.id, node.y, onUpdate, readOnly],
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
      freshTopicRef.current = id;
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
    (sourceId: string, startEvent: Parameters<typeof startMindmapDrag>[0]['startEvent']) =>
      startMindmapDrag({
        sourceId,
        startEvent,
        root,
        topics: layout.topics,
        nodeId: node.id,
        applyRoot,
        setSelectedId,
        setReorder,
        onMergeTopic,
        onSplitTopic,
      }),
    [applyRoot, layout.topics, node.id, onMergeTopic, onSplitTopic, root],
  );

  useLayoutEffect(() => {
    const pendingId = pendingFocusRef.current;
    if (!pendingId) return;
    if (findTopicPath(root, pendingId)) {
      setSelectedId(pendingId);
      setDraft(null);
      setEditingInitialInput(undefined);
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

  const enterTopicEdit = useCallback((topicId: string, initialInput?: string) => {
    setSelectedId(topicId);
    setEditingInitialInput(initialInput);
    setDraft(initialInput === undefined ? null : { id: topicId, text: initialInput });
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
      case 'exit': {
        const typed = draft?.id === topicId ? draft.text : '';
        setEditingInitialInput(undefined);
        setEditingId(null);
        setDraft(null);
        if (freshTopicRef.current === topicId && !typed.trim()) removeTopic(topicId);
        freshTopicRef.current = null;
        break;
      }
    }
  }, [addChild, addSibling, draft, moveSelection, readOnly, removeTopic, toggleTopicCollapsed, unindentTopic]);

  const updateDraft = useCallback((topicId: string, text: string) => {
    setDraft({ id: topicId, text });
  }, []);

  const getDropHint = useCallback((topicId: string): DropHint => {
    if (!reorder?.target) return null;
    if (reorder.target.kind === 'child' && reorder.target.parentId === topicId) return 'child';
    if (reorder.target.kind === 'before' && reorder.target.anchorId === topicId) return 'before';
    if (reorder.target.kind === 'after' && reorder.target.anchorId === topicId) return 'after';
    return null;
  }, [reorder]);

  return {
    addChild,
    beginReorder,
    editingId,
    editingInitialInput,
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
    updateDraft,
    viewportHeight,
    viewportWidth,
  };
};
