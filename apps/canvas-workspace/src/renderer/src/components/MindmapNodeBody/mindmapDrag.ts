import type { MouseEvent as ReactMouseEvent } from 'react';
import type { MindmapTopic } from '../../types';
import {
  isDescendant,
  moveTopic,
  type DropTarget,
  type LaidOutTopic,
} from '../../utils/mindmapLayout';
import type { MindmapNodeBodyProps } from './types';

export interface MindmapReorderState {
  sourceId: string;
  target: DropTarget | null;
}

interface StartMindmapDragOptions {
  sourceId: string;
  startEvent: ReactMouseEvent;
  root: MindmapTopic;
  topics: LaidOutTopic[];
  nodeId: string;
  applyRoot: (root: MindmapTopic) => void;
  setSelectedId: (id: string) => void;
  setReorder: (state: MindmapReorderState | null) => void;
  onMergeTopic: MindmapNodeBodyProps['onMergeTopic'];
  onSplitTopic: MindmapNodeBodyProps['onSplitTopic'];
}

export const startMindmapDrag = ({
  sourceId,
  startEvent,
  root,
  topics,
  nodeId,
  applyRoot,
  setSelectedId,
  setReorder,
  onMergeTopic,
  onSplitTopic,
}: StartMindmapDragOptions) => {
  const startX = startEvent.clientX;
  const startY = startEvent.clientY;
  const threshold = 5;
  let started = false;
  const contentEl = startEvent.currentTarget.closest('.mindmap-content') as HTMLElement | null;
  const sourceBodyEl = startEvent.currentTarget.closest('.mindmap-node-body') as HTMLElement | null;
  const sourceSurfaceEl = sourceBodyEl?.closest('.canvas-transform');
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  let externalDropEl: HTMLElement | null = null;
  type DragHit = {
    nodeId: string;
    target: DropTarget;
    topicEl: HTMLElement;
  };

  const clearExternalDropHint = () => {
    externalDropEl?.classList.remove(
      'mindmap-topic--drop-before',
      'mindmap-topic--drop-after',
      'mindmap-topic--drop-child',
    );
    externalDropEl = null;
  };

  const showExternalDropHint = (hit: DragHit | null) => {
    clearExternalDropHint();
    if (!hit || hit.nodeId === nodeId) return;
    const hint = hit.target.kind === 'child' ? 'child' : hit.target.kind;
    hit.topicEl.classList.add(`mindmap-topic--drop-${hint}`);
    externalDropEl = hit.topicEl;
  };

  const resolveTopicElement = (el: Element): HTMLElement | null => {
    const topicEl = el.closest('.mindmap-topic');
    return topicEl instanceof HTMLElement ? topicEl : null;
  };

  const isValidLocalTarget = (targetId: string | null): targetId is string => (
    !!targetId
    && targetId !== sourceId
    && topicById.has(targetId)
    && !isDescendant(root, sourceId, targetId)
  );

  const targetFromTopicRect = (
    targetId: string,
    rect: DOMRect,
    clientX: number,
    clientY: number,
    isRootTarget: boolean,
  ): DropTarget => {
    const relX = (clientX - rect.left) / Math.max(1, rect.width);
    const relY = (clientY - rect.top) / Math.max(1, rect.height);
    if (isRootTarget) return { kind: 'child', parentId: targetId };
    if (relX > 0.66 || clientX > rect.right + 18) {
      return { kind: 'child', parentId: targetId };
    }
    if (relY < 0.5) return { kind: 'before', anchorId: targetId };
    return { kind: 'after', anchorId: targetId };
  };

  const hitTest = (clientX: number, clientY: number): DragHit | null => {
    const stack = document.elementsFromPoint(clientX, clientY);
    let pillEl: HTMLElement | null = null;
    for (const el of stack) {
      if (el instanceof Element) pillEl = resolveTopicElement(el);
      if (pillEl) break;
    }
    if (pillEl) {
      const targetId = pillEl.getAttribute('data-topic-id');
      const targetBody = pillEl.closest<HTMLElement>('.mindmap-node-body');
      const targetNodeId = targetBody?.dataset.mindmapNodeId;
      const localTarget = targetNodeId === nodeId;
      const editableSameSurface =
        targetBody?.dataset.mindmapDropEnabled === 'true'
        && targetBody.closest('.canvas-transform') === sourceSurfaceEl;
      if (
        targetId
        && targetNodeId
        && editableSameSurface
        && (!localTarget || isValidLocalTarget(targetId))
      ) {
        return {
          nodeId: targetNodeId,
          target: targetFromTopicRect(
            targetId,
            pillEl.getBoundingClientRect(),
            clientX,
            clientY,
            pillEl.classList.contains('mindmap-topic--root'),
          ),
          topicEl: pillEl,
        };
      }
    }

    if (!contentEl) return null;
    const contentRect = contentEl.getBoundingClientRect();
    const withinLooseMindmap =
      clientX >= contentRect.left - 72
      && clientX <= contentRect.right + 128
      && clientY >= contentRect.top - 48
      && clientY <= contentRect.bottom + 48;
    if (!withinLooseMindmap) return null;

    let best: { id: string; rect: DOMRect; score: number } | null = null;
    const topicEls = contentEl.querySelectorAll<HTMLElement>('.mindmap-topic');
    for (const candidateEl of topicEls) {
      const targetId = candidateEl.getAttribute('data-topic-id');
      if (!isValidLocalTarget(targetId)) continue;
      const rect = candidateEl.getBoundingClientRect();
      const clampedX = Math.max(rect.left, Math.min(clientX, rect.right));
      const clampedY = Math.max(rect.top, Math.min(clientY, rect.bottom));
      const dx = clientX - clampedX;
      const dy = clientY - clampedY;
      const rowBias = Math.abs(clientY - (rect.top + rect.height / 2)) * 0.4;
      const score = Math.hypot(dx, dy) + rowBias;
      if (!best || score < best.score) best = { id: targetId, rect, score };
    }

    if (!best || best.score > 180) return null;
    const topicEl = contentEl.querySelector<HTMLElement>(
      `.mindmap-topic[data-topic-id="${CSS.escape(best.id)}"]`,
    );
    if (!topicEl) return null;
    return {
      nodeId,
      target: targetFromTopicRect(
        best.id,
        best.rect,
        clientX,
        clientY,
        best.id === root.id,
      ),
      topicEl,
    };
  };

  const onMove = (event: MouseEvent) => {
    if (!started) {
      if (Math.hypot(event.clientX - startX, event.clientY - startY) < threshold) return;
      started = true;
      window.getSelection()?.removeAllRanges();
      setReorder({ sourceId, target: null });
    }
    const hit = hitTest(event.clientX, event.clientY);
    showExternalDropHint(hit);
    setReorder({
      sourceId,
      target: hit?.nodeId === nodeId ? hit.target : null,
    });
  };

  const onUp = (event: MouseEvent) => {
    cleanup();
    if (!started) return;
    const hit = hitTest(event.clientX, event.clientY);
    setReorder(null);
    if (hit?.nodeId !== nodeId) {
      if (hit) {
        onMergeTopic?.({
          sourceNodeId: nodeId,
          sourceTopicId: sourceId,
          targetNodeId: hit.nodeId,
          target: hit.target,
        });
        return;
      }
      if (sourceId !== root.id && sourceBodyEl) {
        const rect = sourceBodyEl.getBoundingClientRect();
        const outsideSource =
          event.clientX < rect.left
          || event.clientX > rect.right
          || event.clientY < rect.top
          || event.clientY > rect.bottom;
        if (outsideSource) {
          onSplitTopic?.(nodeId, sourceId, event.clientX, event.clientY);
        }
      }
      return;
    }
    if (sourceId === root.id) return;
    const next = moveTopic(root, sourceId, hit.target);
    if (next) {
      applyRoot(next);
      setSelectedId(sourceId);
    }
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      cleanup();
      setReorder(null);
    }
  };

  function cleanup() {
    clearExternalDropHint();
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    window.removeEventListener('keydown', onKey);
  }

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  window.addEventListener('keydown', onKey);
};
