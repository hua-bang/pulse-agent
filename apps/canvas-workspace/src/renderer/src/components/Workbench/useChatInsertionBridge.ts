import { useCallback, useRef } from 'react';
import type { AgentContextDomSelectionRef, CanvasNode } from '../../types';

interface UseChatInsertionBridgeOptions {
  allNodes: Record<string, CanvasNode[]>;
  openChat: () => void;
}

export function useChatInsertionBridge({
  allNodes,
  openChat,
}: UseChatInsertionBridgeOptions) {
  const insertMentionByWorkspaceRef = useRef<Map<string, (node: CanvasNode) => void>>(new Map());
  const insertDomSelectionByWorkspaceRef = useRef<Map<string, (selection: AgentContextDomSelectionRef) => void>>(new Map());

  const registerInsertMention = useCallback((workspaceId: string, fn: (node: CanvasNode) => void) => {
    insertMentionByWorkspaceRef.current.set(workspaceId, fn);
    return () => {
      insertMentionByWorkspaceRef.current.delete(workspaceId);
    };
  }, []);

  const registerInsertDomSelectionMention = useCallback((workspaceId: string, fn: (selection: AgentContextDomSelectionRef) => void) => {
    insertDomSelectionByWorkspaceRef.current.set(workspaceId, fn);
    return () => {
      insertDomSelectionByWorkspaceRef.current.delete(workspaceId);
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

  const handleAddDomSelectionToChat = useCallback((workspaceId: string, selection: AgentContextDomSelectionRef) => {
    openChat();
    const tryInsert = () => {
      const fn = insertDomSelectionByWorkspaceRef.current.get(workspaceId);
      if (fn) {
        fn({ ...selection, workspaceId: selection.workspaceId ?? workspaceId });
        return true;
      }
      return false;
    };
    if (!tryInsert()) {
      requestAnimationFrame(() => { tryInsert(); });
    }
  }, [openChat]);

  return {
    handleAddDomSelectionToChat,
    handleAddNodeToChat,
    registerInsertDomSelectionMention,
    registerInsertMention,
  };
}
