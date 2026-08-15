import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AgentContextDomReviewComment,
  CanvasEdge,
  CanvasNode,
  CanvasTransform,
} from '../../../types';
import type { CanvasClipboard } from '../../../types/ui-interaction';

export interface CanvasPreviewSnapshot {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  transform: CanvasTransform;
}

export const EMPTY_CANVAS_PREVIEW_SNAPSHOT: CanvasPreviewSnapshot = {
  nodes: [],
  edges: [],
  transform: { x: 0, y: 0, scale: 1 },
};

interface Options {
  active: boolean;
  editingAllowed: boolean;
  workspaceId: string;
  onNodesChange?: (canvasId: string, nodes: CanvasNode[]) => void;
  onSubmitDomReviewComments?: (
    workspaceId: string,
    comments: AgentContextDomReviewComment[],
  ) => Promise<boolean>;
}

/** Owns the editable preview's transient snapshot, keyboard, and clipboard state. */
export const useCanvasPreviewEditorController = ({
  active,
  editingAllowed,
  workspaceId,
  onNodesChange,
  onSubmitDomReviewComments,
}: Options) => {
  const editorRegionRef = useRef<HTMLDivElement>(null);
  const [snapshot, setSnapshot] = useState<CanvasPreviewSnapshot>(EMPTY_CANVAS_PREVIEW_SNAPSHOT);
  // Store the workspace that requested editing instead of a bare boolean so
  // a canvas preview changing resources drops editability synchronously.
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const editing = editingAllowed && editingWorkspaceId === workspaceId;
  // Visibility keeps embedded node lifecycles live; keyboard ownership is
  // narrower and follows the user's latest interaction across Chat + Canvas.
  const [keyboardOwnerWorkspaceId, setKeyboardOwnerWorkspaceId] = useState<string | null>(null);
  const suspendedKeyboardOwnerRef = useRef<string | null>(null);
  const keyboardActive = active && editing && keyboardOwnerWorkspaceId === workspaceId;
  const [canvasClipboard, setCanvasClipboard] = useState<CanvasClipboard | null>(null);
  const clipboard = canvasClipboard?.sourceWorkspaceId === workspaceId ? canvasClipboard : null;

  useEffect(() => {
    if (!editingAllowed) setEditingWorkspaceId(null);
    if (!active || !editing) setKeyboardOwnerWorkspaceId(null);
  }, [active, editing, editingAllowed]);

  useEffect(() => {
    if (!editing || !active) return;
    const updateKeyboardOwner = (event: Event) => {
      const target = event.target;
      const insideEditor = target instanceof Node && editorRegionRef.current?.contains(target);
      setKeyboardOwnerWorkspaceId(insideEditor ? workspaceId : null);
    };
    const suspendKeyboard = () => setKeyboardOwnerWorkspaceId((current) => {
      suspendedKeyboardOwnerRef.current = current === workspaceId ? current : null;
      return null;
    });
    const restoreKeyboard = () => {
      if (suspendedKeyboardOwnerRef.current === workspaceId) {
        setKeyboardOwnerWorkspaceId(workspaceId);
      }
      suspendedKeyboardOwnerRef.current = null;
    };
    document.addEventListener('pointerdown', updateKeyboardOwner, true);
    document.addEventListener('focusin', updateKeyboardOwner, true);
    window.addEventListener('blur', suspendKeyboard);
    window.addEventListener('focus', restoreKeyboard);
    return () => {
      document.removeEventListener('pointerdown', updateKeyboardOwner, true);
      document.removeEventListener('focusin', updateKeyboardOwner, true);
      window.removeEventListener('blur', suspendKeyboard);
      window.removeEventListener('focus', restoreKeyboard);
      suspendedKeyboardOwnerRef.current = null;
    };
  }, [active, editing, workspaceId]);

  const replaceSnapshot = useCallback((next: CanvasPreviewSnapshot) => {
    setSnapshot(next);
  }, []);
  const handleNodesChange = useCallback((canvasId: string, nodes: CanvasNode[]) => {
    setSnapshot((current) => ({ ...current, nodes }));
    onNodesChange?.(canvasId, nodes);
  }, [onNodesChange]);
  const handleEdgesChange = useCallback((_canvasId: string, edges: CanvasEdge[]) => {
    setSnapshot((current) => ({ ...current, edges }));
  }, []);
  const handleClipboardChange = useCallback((next: CanvasClipboard | null) => {
    setCanvasClipboard(next?.sourceWorkspaceId === workspaceId ? next : null);
  }, [workspaceId]);
  const handleSubmitDomReviewComments = useCallback(
    (comments: AgentContextDomReviewComment[]) => (
      onSubmitDomReviewComments?.(workspaceId, comments) ?? Promise.resolve(false)
    ),
    [onSubmitDomReviewComments, workspaceId],
  );
  const handleEditToggle = useCallback(() => {
    if (!editingAllowed) return;
    if (editing) {
      setEditingWorkspaceId(null);
      setKeyboardOwnerWorkspaceId(null);
      return;
    }
    setEditingWorkspaceId(workspaceId);
    setKeyboardOwnerWorkspaceId(workspaceId);
  }, [editing, editingAllowed, workspaceId]);

  return {
    clipboard,
    editing,
    editorRegionRef,
    handleClipboardChange,
    handleEdgesChange,
    handleEditToggle,
    handleNodesChange,
    handleSubmitDomReviewComments,
    keyboardActive,
    replaceSnapshot,
    snapshot,
  };
};
