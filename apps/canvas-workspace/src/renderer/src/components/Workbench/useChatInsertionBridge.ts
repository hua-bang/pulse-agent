import { useCallback, useRef } from 'react';
import type { AgentContextDomReviewComment, AgentContextDomSelectionRef, CanvasNode } from '../../types';

interface UseChatInsertionBridgeOptions {
  allNodes: Record<string, CanvasNode[]>;
  openChat: () => void;
}

export function useChatInsertionBridge({
  allNodes,
  openChat,
}: UseChatInsertionBridgeOptions) {
  const insertMentionByWorkspaceRef = useRef<Map<string, (node: CanvasNode, sourceWorkspaceId?: string) => void>>(new Map());
  const insertDomSelectionByWorkspaceRef = useRef<Map<string, (selection: AgentContextDomSelectionRef) => void>>(new Map());
  const pendingDomSelectionsByWorkspaceRef = useRef<Map<string, AgentContextDomSelectionRef[]>>(new Map());
  const submitDomReviewByWorkspaceRef = useRef<Map<string, (comments: AgentContextDomReviewComment[]) => Promise<boolean>>>(new Map());

  const registerInsertMention = useCallback((workspaceId: string, fn: (node: CanvasNode, sourceWorkspaceId?: string) => void) => {
    insertMentionByWorkspaceRef.current.set(workspaceId, fn);
    return () => {
      insertMentionByWorkspaceRef.current.delete(workspaceId);
    };
  }, []);

  const registerInsertDomSelectionMention = useCallback((workspaceId: string, fn: (selection: AgentContextDomSelectionRef) => void) => {
    insertDomSelectionByWorkspaceRef.current.set(workspaceId, fn);
    const pending = pendingDomSelectionsByWorkspaceRef.current.get(workspaceId) ?? [];
    pendingDomSelectionsByWorkspaceRef.current.delete(workspaceId);
    for (const selection of pending) fn(selection);
    return () => {
      insertDomSelectionByWorkspaceRef.current.delete(workspaceId);
    };
  }, []);

  const registerSubmitDomReviewComments = useCallback((workspaceId: string, fn: (comments: AgentContextDomReviewComment[]) => Promise<boolean>) => {
    submitDomReviewByWorkspaceRef.current.set(workspaceId, fn);
    return () => {
      submitDomReviewByWorkspaceRef.current.delete(workspaceId);
    };
  }, []);

  const handleAddNodeToChat = useCallback((workspaceId: string, nodeId: string) => {
    const node = (allNodes[workspaceId] ?? []).find((item) => item.id === nodeId);
    if (!node) return;
    openChat();
    const tryInsert = () => {
      const fn = insertMentionByWorkspaceRef.current.get(workspaceId);
      if (fn) {
        fn(node);
        return true;
      }
      return false;
    };
    if (!tryInsert()) {
      requestAnimationFrame(() => { tryInsert(); });
    }
  }, [allNodes, openChat]);

  /** Insert a node from ANOTHER workspace (dock canvas preview) into the
   *  given (active) workspace's composer as a cross-workspace mention. */
  const handleAddPreviewNodeToChat = useCallback((activeWorkspaceId: string, sourceWorkspaceId: string, node: CanvasNode) => {
    openChat();
    const tryInsert = () => {
      const fn = insertMentionByWorkspaceRef.current.get(activeWorkspaceId);
      if (fn) {
        fn(node, sourceWorkspaceId);
        return true;
      }
      return false;
    };
    if (!tryInsert()) {
      requestAnimationFrame(() => { tryInsert(); });
    }
  }, [openChat]);

  const handleAddDomSelectionToChat = useCallback((workspaceId: string, selection: AgentContextDomSelectionRef) => {
    openChat();
    const normalized = { ...selection, workspaceId: selection.workspaceId ?? workspaceId };
    const fn = insertDomSelectionByWorkspaceRef.current.get(workspaceId);
    if (fn) fn(normalized);
    else pendingDomSelectionsByWorkspaceRef.current.set(workspaceId, [
      ...(pendingDomSelectionsByWorkspaceRef.current.get(workspaceId) ?? []),
      normalized,
    ]);
  }, [openChat]);

  const handleSubmitDomReviewComments = useCallback((workspaceId: string, comments: AgentContextDomReviewComment[]) => {
    openChat();
    const trySubmit = () => {
      const fn = submitDomReviewByWorkspaceRef.current.get(workspaceId);
      return fn ? fn(comments) : null;
    };
    const submitted = trySubmit();
    if (submitted) return submitted;
    return new Promise<boolean>((resolve) => {
      requestAnimationFrame(() => {
        void (trySubmit() ?? Promise.resolve(false)).then(resolve);
      });
    });
  }, [openChat]);

  return {
    handleAddDomSelectionToChat,
    handleAddNodeToChat,
    handleAddPreviewNodeToChat,
    handleSubmitDomReviewComments,
    registerInsertDomSelectionMention,
    registerInsertMention,
    registerSubmitDomReviewComments,
  };
}
