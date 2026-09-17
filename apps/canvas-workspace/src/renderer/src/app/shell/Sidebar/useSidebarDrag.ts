import { useState, type DragEvent } from 'react';
import type { WorkspaceEntry } from '../../../shared/workspaces';
import type { SidebarProps } from './types';

const WS_DRAG = 'application/x-workspace-id';
const FOLDER_DRAG = 'application/x-folder-id';
type Options = Pick<SidebarProps, 'onMoveWorkspace' | 'onReorderWorkspace' | 'onReorderFolder'>;

export const useSidebarDrag = ({ onMoveWorkspace, onReorderWorkspace, onReorderFolder }: Options) => {
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [folderDropTarget, setFolderDropTarget] = useState<string | null>(null);
  const [wsDropBeforeId, setWsDropBeforeId] = useState<string | null>(null);

  // Workspace drag
  const handleWsDragStart = (e: DragEvent, wsId: string) => {
    e.dataTransfer.setData(WS_DRAG, wsId);
    e.dataTransfer.effectAllowed = 'move';
    (e.currentTarget as HTMLElement).classList.add('sidebar-dragging');
  };
  const handleWsDragEnd = (e: DragEvent) => {
    (e.currentTarget as HTMLElement).classList.remove('sidebar-dragging');
    setDropTarget(null);
    setWsDropBeforeId(null);
  };
  const handleWsDragOver = (e: DragEvent, targetId: string) => {
    if (!e.dataTransfer.types.includes(WS_DRAG)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(targetId);
  };
  const handleWsDragLeave = (e: DragEvent, targetId: string) => {
    const rel = e.relatedTarget as HTMLElement | null;
    if (rel && (e.currentTarget as HTMLElement).contains(rel)) return;
    if (dropTarget === targetId) setDropTarget(null);
  };
  const handleWsDrop = (e: DragEvent, folderId: string | undefined) => {
    e.preventDefault();
    const wsId = e.dataTransfer.getData(WS_DRAG);
    if (wsId) onMoveWorkspace(wsId, folderId);
    setDropTarget(null);
    setWsDropBeforeId(null);
  };

  // Workspace-on-workspace reorder (drop A before B)
  const handleWsReorderDragOver = (e: DragEvent, targetWsId: string) => {
    if (!e.dataTransfer.types.includes(WS_DRAG)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setWsDropBeforeId(targetWsId);
    setDropTarget(null);
  };
  const handleWsReorderDragLeave = (e: DragEvent, targetWsId: string) => {
    const rel = e.relatedTarget as HTMLElement | null;
    if (rel && (e.currentTarget as HTMLElement).contains(rel)) return;
    if (wsDropBeforeId === targetWsId) setWsDropBeforeId(null);
  };
  const handleWsReorderDrop = (e: DragEvent, targetWs: WorkspaceEntry) => {
    if (!e.dataTransfer.types.includes(WS_DRAG)) return;
    e.preventDefault();
    e.stopPropagation();
    const wsId = e.dataTransfer.getData(WS_DRAG);
    if (wsId && wsId !== targetWs.id) {
      onReorderWorkspace(wsId, targetWs.id, targetWs.folderId);
    }
    setWsDropBeforeId(null);
    setDropTarget(null);
  };

  // Folder drag
  const handleFolderDragStart = (e: DragEvent, folderId: string) => {
    e.dataTransfer.setData(FOLDER_DRAG, folderId);
    e.dataTransfer.effectAllowed = 'move';
    (e.currentTarget as HTMLElement).classList.add('sidebar-dragging');
  };
  const handleFolderDragEnd = (e: DragEvent) => {
    (e.currentTarget as HTMLElement).classList.remove('sidebar-dragging');
    setFolderDropTarget(null);
  };
  const handleFolderDragOver = (e: DragEvent, targetFolderId: string) => {
    if (!e.dataTransfer.types.includes(FOLDER_DRAG)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setFolderDropTarget(targetFolderId);
  };
  const handleFolderDragLeave = (e: DragEvent, targetFolderId: string) => {
    const rel = e.relatedTarget as HTMLElement | null;
    if (rel && (e.currentTarget as HTMLElement).contains(rel)) return;
    if (folderDropTarget === targetFolderId) setFolderDropTarget(null);
  };
  const handleFolderDrop = (e: DragEvent, beforeFolderId: string | null) => {
    e.preventDefault();
    const fid = e.dataTransfer.getData(FOLDER_DRAG);
    if (fid && fid !== beforeFolderId) onReorderFolder(fid, beforeFolderId);
    setFolderDropTarget(null);
  };

  // Combined folder handlers (receives both WS and folder drags)
  const onFolderCombinedDragOver = (e: DragEvent, folderId: string) => {
    handleWsDragOver(e, folderId);
    handleFolderDragOver(e, folderId);
  };
  const onFolderCombinedDragLeave = (e: DragEvent, folderId: string) => {
    handleWsDragLeave(e, folderId);
    handleFolderDragLeave(e, folderId);
  };
  const onFolderCombinedDrop = (e: DragEvent, folderId: string) => {
    if (e.dataTransfer.types.includes(WS_DRAG)) handleWsDrop(e, folderId);
    else if (e.dataTransfer.types.includes(FOLDER_DRAG)) handleFolderDrop(e, folderId);
  };

  return {
    dropTarget,
    folderDropTarget,
    wsDropBeforeId,
    handleWsDragStart,
    handleWsDragEnd,
    handleWsDragOver,
    handleWsDragLeave,
    handleWsDrop,
    handleWsReorderDragOver,
    handleWsReorderDragLeave,
    handleWsReorderDrop,
    handleFolderDragStart,
    handleFolderDragEnd,
    onFolderCombinedDragOver,
    onFolderCombinedDragLeave,
    onFolderCombinedDrop,
  };
};
