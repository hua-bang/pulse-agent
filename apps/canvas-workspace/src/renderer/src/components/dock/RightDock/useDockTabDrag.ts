import { useRef, type DragEvent } from 'react';
import type { DockStore } from './dock-store';
import { isTerminalTabId } from './dock-tab-ids';

export const useDockTabDrag = (store: DockStore) => {
  const draggedIdRef = useRef<string | null>(null);
  const draggedShellRef = useRef<HTMLElement | null>(null);
  const dropTargetRef = useRef<HTMLElement | null>(null);

  const clear = () => {
    draggedShellRef.current?.removeAttribute('data-dragging');
    dropTargetRef.current?.removeAttribute('data-drop-position');
    draggedIdRef.current = null;
    draggedShellRef.current = null;
    dropTargetRef.current = null;
  };
  const onDragStart = (event: DragEvent<HTMLElement>, id: string) => {
    clear();
    draggedIdRef.current = id;
    draggedShellRef.current = event.currentTarget.parentElement;
    draggedShellRef.current?.setAttribute('data-dragging', 'true');
  };
  const onDragOver = (event: DragEvent<HTMLElement>, targetId: string) => {
    const sourceId = draggedIdRef.current;
    if (!sourceId || sourceId === targetId || isTerminalTabId(sourceId) !== isTerminalTabId(targetId)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    const position = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
    if (dropTargetRef.current !== event.currentTarget) {
      dropTargetRef.current?.removeAttribute('data-drop-position');
      dropTargetRef.current = event.currentTarget;
    }
    event.currentTarget.dataset.dropPosition = position;
  };
  const onDrop = (event: DragEvent<HTMLElement>, targetId: string) => {
    const sourceId = draggedIdRef.current;
    if (!sourceId || sourceId === targetId || isTerminalTabId(sourceId) !== isTerminalTabId(targetId)) {
      clear();
      return;
    }
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    store.reorderTab(sourceId, targetId, event.clientX < rect.left + rect.width / 2 ? 'before' : 'after');
    clear();
  };
  return { clear, onDragStart, onDragOver, onDrop };
};
