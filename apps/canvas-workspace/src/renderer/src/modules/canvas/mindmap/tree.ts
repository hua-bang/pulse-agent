import type { MindmapTopic } from '../../../types';

/**
 * Find a topic by id and return a path from root → topic. Returns null
 * when the id is not present. The path is used by every mutation below
 * so the caller doesn't have to re-traverse.
 */
export const findTopicPath = (
  root: MindmapTopic,
  id: string,
): MindmapTopic[] | null => {
  if (root.id === id) return [root];
  for (const child of root.children) {
    const sub = findTopicPath(child, id);
    if (sub) return [root, ...sub];
  }
  return null;
};

/**
 * Return a new tree produced by applying `fn` to every topic. `fn` may
 * return a new topic (replacing the input) or `null` to delete. The
 * root is never allowed to be deleted — callers that need that case
 * should handle it outside this helper.
 */
export const mapTopics = (
  root: MindmapTopic,
  fn: (t: MindmapTopic, parent: MindmapTopic | null) => MindmapTopic | null,
): MindmapTopic => {
  const walk = (t: MindmapTopic, parent: MindmapTopic | null): MindmapTopic => {
    const mapped = fn(t, parent) ?? t;
    return {
      ...mapped,
      children: mapped.children
        .map((c) => {
          const result = fn(c, mapped);
          if (result === null) return null;
          // Recurse into the returned (possibly-rewritten) child.
          return walk(result ?? c, mapped);
        })
        .filter((c): c is MindmapTopic => c !== null),
    };
  };
  return walk(root, null);
};

/** Insert a child topic under `parentId`. If `afterId` is provided, the
 *  child lands directly after that sibling; otherwise it appends. */
export const insertChild = (
  root: MindmapTopic,
  parentId: string,
  child: MindmapTopic,
  afterId?: string,
): MindmapTopic => {
  const walk = (t: MindmapTopic): MindmapTopic => {
    if (t.id === parentId) {
      const children = [...t.children];
      if (afterId) {
        const idx = children.findIndex((c) => c.id === afterId);
        if (idx >= 0) {
          children.splice(idx + 1, 0, child);
          return { ...t, children };
        }
      }
      children.push(child);
      // Inserting children implicitly expands the parent.
      return { ...t, children, collapsed: false };
    }
    return { ...t, children: t.children.map(walk) };
  };
  return walk(root);
};

/** Replace a topic's text. Returns the root unchanged if no match. */
export const setTopicText = (
  root: MindmapTopic,
  id: string,
  text: string,
): MindmapTopic => {
  const walk = (t: MindmapTopic): MindmapTopic => {
    if (t.id === id) return { ...t, text };
    return { ...t, children: t.children.map(walk) };
  };
  return walk(root);
};

/** Toggle collapsed on a topic. The root can't be collapsed. */
export const toggleCollapsed = (
  root: MindmapTopic,
  id: string,
): MindmapTopic => {
  if (root.id === id) return root;
  const walk = (t: MindmapTopic): MindmapTopic => {
    if (t.id === id) return { ...t, collapsed: !t.collapsed };
    return { ...t, children: t.children.map(walk) };
  };
  return walk(root);
};

/**
 * Delete a non-root topic. Returns `{ root, nextFocusId }` where
 * `nextFocusId` points at the sibling above (or the parent if the
 * victim was a first child) so the caller can keep focus reasonable.
 */
export const deleteTopic = (
  root: MindmapTopic,
  id: string,
): { root: MindmapTopic; nextFocusId: string } | null => {
  if (root.id === id) return null;
  let nextFocusId = root.id;
  const walk = (t: MindmapTopic): MindmapTopic => {
    const idx = t.children.findIndex((c) => c.id === id);
    if (idx >= 0) {
      const next = [...t.children];
      next.splice(idx, 1);
      if (next.length > 0) {
        nextFocusId = next[Math.max(0, idx - 1)].id;
      } else {
        nextFocusId = t.id;
      }
      return { ...t, children: next };
    }
    return { ...t, children: t.children.map(walk) };
  };
  const nextRoot = walk(root);
  return { root: nextRoot, nextFocusId };
};

/** Return the parent topic for a given id, or null for the root/missing. */
export const findParent = (
  root: MindmapTopic,
  id: string,
): MindmapTopic | null => {
  if (root.id === id) return null;
  const walk = (t: MindmapTopic): MindmapTopic | null => {
    for (const c of t.children) {
      if (c.id === id) return t;
      const deeper = walk(c);
      if (deeper) return deeper;
    }
    return null;
  };
  return walk(root);
};

/** True if `descendantId` lives anywhere in the subtree rooted at
 *  `ancestorId`. Used to reject drag-reorders that would create a cycle
 *  (dropping a topic into one of its own descendants). */
export const isDescendant = (
  root: MindmapTopic,
  ancestorId: string,
  descendantId: string,
): boolean => {
  if (ancestorId === descendantId) return false;
  const findAncestor = (t: MindmapTopic): MindmapTopic | null => {
    if (t.id === ancestorId) return t;
    for (const c of t.children) {
      const hit = findAncestor(c);
      if (hit) return hit;
    }
    return null;
  };
  const subtree = findAncestor(root);
  if (!subtree) return false;
  const walk = (t: MindmapTopic): boolean => {
    if (t.id === descendantId) return true;
    return t.children.some(walk);
  };
  return subtree.children.some(walk);
};

/**
 * Drop target for a drag-reorder. `before` / `after` insert as a sibling
 * of `anchorId`; `child` appends as the last child of `parentId`.
 */
export type DropTarget =
  | { kind: 'before'; anchorId: string }
  | { kind: 'after'; anchorId: string }
  | { kind: 'child'; parentId: string };

/**
 * Move `sourceId` to `target`. Returns the new root, or `null` when the
 * move is invalid (source is the root, target lives in source's subtree,
 * or anchor/parent isn't found). Implementation: locate the source
 * subtree, splice it out of its current parent, then insert it at the
 * target. Handles the same-parent reorder case (where removing the
 * source shifts the anchor's index) by computing the insertion index
 * after the removal.
 */
export const moveTopic = (
  root: MindmapTopic,
  sourceId: string,
  target: DropTarget,
): MindmapTopic | null => {
  if (sourceId === root.id) return null;
  // No-op moves: dropping a topic onto itself or onto its current parent
  // when the position wouldn't change.
  if (target.kind !== 'child' && target.anchorId === sourceId) return null;
  if (target.kind === 'child' && target.parentId === sourceId) return null;
  if (isDescendant(root, sourceId, target.kind === 'child' ? target.parentId : target.anchorId)) {
    return null;
  }

  // Lift the source subtree out of the tree.
  const sourcePath = findTopicPath(root, sourceId);
  if (!sourcePath) return null;
  const sourceTopic = sourcePath[sourcePath.length - 1];
  const removed = deleteTopic(root, sourceId);
  if (!removed) return null;
  let next = removed.root;

  if (target.kind === 'child') {
    next = insertChild(next, target.parentId, sourceTopic);
    return next;
  }

  // Sibling drop: locate the anchor's parent in the post-removal tree.
  const anchorParent = findParent(next, target.anchorId);
  if (!anchorParent) return null;
  const idx = anchorParent.children.findIndex((c) => c.id === target.anchorId);
  if (idx < 0) return null;
  const insertAfterId =
    target.kind === 'after'
      ? target.anchorId
      : idx > 0
        ? anchorParent.children[idx - 1].id
        : undefined;
  // `insertChild` with no afterId appends — we want to prepend when
  // dropping `before` the first child. Handle that explicitly.
  if (target.kind === 'before' && idx === 0) {
    const walk = (t: MindmapTopic): MindmapTopic => {
      if (t.id === anchorParent.id) {
        return { ...t, children: [sourceTopic, ...t.children], collapsed: false };
      }
      return { ...t, children: t.children.map(walk) };
    };
    return walk(next);
  }
  return insertChild(next, anchorParent.id, sourceTopic, insertAfterId);
};
