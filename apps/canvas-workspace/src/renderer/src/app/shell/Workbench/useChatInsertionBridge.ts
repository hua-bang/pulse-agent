import { useCallback, useRef, useState } from 'react';
import type { AgentContextDomReviewComment, AgentContextDomSelectionRef, AgentContextTabRef, CanvasNode } from '../../../types';
import type {
  ChatDeliveryReceipt,
  ChatInsertion,
  ChatPromptSubmission,
  ChatTarget,
  ChatTargetBroker,
} from '../../../modules/chat';

interface UseChatInsertionBridgeOptions {
  allNodes: Record<string, CanvasNode[]>;
  openChat: () => void;
  deliverToActiveTarget?: ChatTargetBroker['deliver'];
}

interface PendingNodeMention {
  node: CanvasNode;
  sourceWorkspaceId?: string;
}

interface PendingSubmission<T> {
  payload: T;
  resolve: (submitted: boolean) => void;
  timeoutId: number;
}

type Submitter<T> = (payload: T) => Promise<boolean>;

const SUBMISSION_REGISTRATION_TIMEOUT_MS = 2_000;
const MAX_PENDING_SUBMISSIONS = 8;

/**
 * Per-workspace submitters that send a whole chat turn (DOM review, canvas
 * prompt). A submission made before that workspace's composer registers waits
 * briefly for it, then resolves false instead of hanging.
 */
const createSubmissionQueue = <T,>() => {
  const submitters = new Map<string, Submitter<T>>();
  const pending = new Map<string, PendingSubmission<T>[]>();

  const register = (workspaceId: string, fn: Submitter<T>) => {
    submitters.set(workspaceId, fn);
    const waiting = pending.get(workspaceId) ?? [];
    pending.delete(workspaceId);
    for (const request of waiting) {
      window.clearTimeout(request.timeoutId);
      try {
        void fn(request.payload).then(request.resolve, () => request.resolve(false));
      } catch {
        request.resolve(false);
      }
    }
    return () => {
      if (submitters.get(workspaceId) === fn) submitters.delete(workspaceId);
    };
  };

  const submit = async (workspaceId: string, payload: T): Promise<boolean> => {
    const fn = submitters.get(workspaceId);
    if (fn) return await fn(payload);
    return await new Promise<boolean>((resolve) => {
      const request: PendingSubmission<T> = { payload, resolve, timeoutId: 0 };
      request.timeoutId = window.setTimeout(() => {
        const remaining = (pending.get(workspaceId) ?? []).filter(candidate => candidate !== request);
        if (remaining.length > 0) pending.set(workspaceId, remaining);
        else pending.delete(workspaceId);
        resolve(false);
      }, SUBMISSION_REGISTRATION_TIMEOUT_MS);
      const waiting = pending.get(workspaceId) ?? [];
      if (waiting.length >= MAX_PENDING_SUBMISSIONS) {
        const dropped = waiting.shift();
        if (dropped) {
          window.clearTimeout(dropped.timeoutId);
          dropped.resolve(false);
        }
      }
      pending.set(workspaceId, [...waiting, request]);
    });
  };

  return { register, submit };
};

export function useChatInsertionBridge({
  allNodes,
  openChat,
  deliverToActiveTarget,
}: UseChatInsertionBridgeOptions) {
  const insertMentionByWorkspaceRef = useRef<Map<string, (node: CanvasNode, sourceWorkspaceId?: string) => void>>(new Map());
  const pendingNodeMentionsByWorkspaceRef = useRef<Map<string, PendingNodeMention[]>>(new Map());
  const insertDomSelectionByWorkspaceRef = useRef<Map<string, (selection: AgentContextDomSelectionRef) => void>>(new Map());
  const pendingDomSelectionsByWorkspaceRef = useRef<Map<string, AgentContextDomSelectionRef[]>>(new Map());
  const insertTabByWorkspaceRef = useRef<Map<string, (tab: AgentContextTabRef) => void>>(new Map());
  const pendingTabsByWorkspaceRef = useRef<Map<string, AgentContextTabRef[]>>(new Map());
  const [domReviewQueue] = useState(() => createSubmissionQueue<AgentContextDomReviewComment[]>());
  const [promptQueue] = useState(() => createSubmissionQueue<ChatPromptSubmission>());
  const startSkillChatByWorkspaceRef = useRef<Map<string, (skillName: string) => Promise<void>>>(new Map());
  const pendingSkillByWorkspaceRef = useRef<Map<string, string>>(new Map());

  const registerInsertMention = useCallback((workspaceId: string, fn: (node: CanvasNode, sourceWorkspaceId?: string) => void) => {
    insertMentionByWorkspaceRef.current.set(workspaceId, fn);
    const pending = pendingNodeMentionsByWorkspaceRef.current.get(workspaceId) ?? [];
    pendingNodeMentionsByWorkspaceRef.current.delete(workspaceId);
    for (const mention of pending) {
      if (mention.sourceWorkspaceId !== undefined) fn(mention.node, mention.sourceWorkspaceId);
      else fn(mention.node);
    }
    return () => {
      insertMentionByWorkspaceRef.current.delete(workspaceId);
    };
  }, []);

  const insertOrQueueMention = useCallback((workspaceId: string, mention: PendingNodeMention) => {
    const fn = insertMentionByWorkspaceRef.current.get(workspaceId);
    if (fn) {
      if (mention.sourceWorkspaceId !== undefined) fn(mention.node, mention.sourceWorkspaceId);
      else fn(mention.node);
      return true;
    }
    pendingNodeMentionsByWorkspaceRef.current.set(workspaceId, [
      ...(pendingNodeMentionsByWorkspaceRef.current.get(workspaceId) ?? []),
      mention,
    ]);
    return false;
  }, []);

  const dockTarget = useCallback((workspaceId: string): ChatTarget => ({
    surface: 'dock',
    scope: { kind: 'workspace', workspaceId },
    // A workspace chat's session-store id is the workspace id itself.
    scopeId: workspaceId,
    sessionId: null,
    composerId: `dock:${workspaceId}`,
    contextSnapshot: { label: workspaceId },
    executionPolicy: 'auto',
  }), []);

  const tryVisibleTarget = useCallback(async (
    insertion: ChatInsertion,
  ): Promise<ChatDeliveryReceipt | null> => {
    if (!deliverToActiveTarget) return null;
    const receipt = await deliverToActiveTarget(insertion);
    return receipt.status === 'unavailable' ? null : receipt;
  }, [deliverToActiveTarget]);

  const registerInsertDomSelectionMention = useCallback((workspaceId: string, fn: (selection: AgentContextDomSelectionRef) => void) => {
    insertDomSelectionByWorkspaceRef.current.set(workspaceId, fn);
    const pending = pendingDomSelectionsByWorkspaceRef.current.get(workspaceId) ?? [];
    pendingDomSelectionsByWorkspaceRef.current.delete(workspaceId);
    for (const selection of pending) fn(selection);
    return () => {
      insertDomSelectionByWorkspaceRef.current.delete(workspaceId);
    };
  }, []);

  const registerInsertTabMention = useCallback((workspaceId: string, fn: (tab: AgentContextTabRef) => void) => {
    insertTabByWorkspaceRef.current.set(workspaceId, fn);
    const pending = pendingTabsByWorkspaceRef.current.get(workspaceId) ?? [];
    pendingTabsByWorkspaceRef.current.delete(workspaceId);
    for (const tab of pending) fn(tab);
    return () => {
      if (insertTabByWorkspaceRef.current.get(workspaceId) === fn) {
        insertTabByWorkspaceRef.current.delete(workspaceId);
      }
    };
  }, []);

  const registerSubmitDomReviewComments = useCallback((
    workspaceId: string,
    fn: Submitter<AgentContextDomReviewComment[]>,
  ) => domReviewQueue.register(workspaceId, fn), [domReviewQueue]);

  const registerSubmitPrompt = useCallback((
    workspaceId: string,
    fn: Submitter<ChatPromptSubmission>,
  ) => promptQueue.register(workspaceId, fn), [promptQueue]);

  const registerStartSkillChat = useCallback((workspaceId: string, fn: (skillName: string) => Promise<void>) => {
    startSkillChatByWorkspaceRef.current.set(workspaceId, fn);
    const pending = pendingSkillByWorkspaceRef.current.get(workspaceId);
    pendingSkillByWorkspaceRef.current.delete(workspaceId);
    if (pending) void fn(pending).finally(openChat);
    return () => {
      if (startSkillChatByWorkspaceRef.current.get(workspaceId) === fn) {
        startSkillChatByWorkspaceRef.current.delete(workspaceId);
      }
    };
  }, [openChat]);

  const handleAddNodeToChat = useCallback(async (
    workspaceId: string,
    nodeId: string,
  ): Promise<ChatDeliveryReceipt> => {
    const node = (allNodes[workspaceId] ?? []).find((item) => item.id === nodeId);
    if (!node) return { status: 'unavailable', target: null };
    if (deliverToActiveTarget) {
      const visibleReceipt = await tryVisibleTarget({
        kind: 'node',
        node,
        sourceWorkspaceId: workspaceId,
      });
      if (visibleReceipt) return visibleReceipt;
    }
    openChat();
    const delivered = insertOrQueueMention(workspaceId, { node });
    return {
      status: delivered ? 'delivered' : 'queued',
      target: dockTarget(workspaceId),
    };
  }, [allNodes, deliverToActiveTarget, dockTarget, insertOrQueueMention, openChat, tryVisibleTarget]);

  /** Insert a node from ANOTHER workspace (dock canvas preview) into the
   *  given (active) workspace's composer as a cross-workspace mention. */
  const handleAddPreviewNodeToChat = useCallback(async (
    activeWorkspaceId: string,
    sourceWorkspaceId: string,
    node: CanvasNode,
  ): Promise<ChatDeliveryReceipt> => {
    if (deliverToActiveTarget) {
      const visibleReceipt = await tryVisibleTarget({
        kind: 'node',
        node,
        sourceWorkspaceId,
      });
      if (visibleReceipt) return visibleReceipt;
    }
    openChat();
    const delivered = insertOrQueueMention(activeWorkspaceId, { node, sourceWorkspaceId });
    return {
      status: delivered ? 'delivered' : 'queued',
      target: dockTarget(activeWorkspaceId),
    };
  }, [deliverToActiveTarget, dockTarget, insertOrQueueMention, openChat, tryVisibleTarget]);

  const handleAddDomSelectionToChat = useCallback(async (
    workspaceId: string,
    selection: AgentContextDomSelectionRef,
  ): Promise<ChatDeliveryReceipt> => {
    const normalized = { ...selection, workspaceId: selection.workspaceId ?? workspaceId };
    if (deliverToActiveTarget) {
      const visibleReceipt = await tryVisibleTarget({
        kind: 'dom-selection',
        selection: normalized,
      });
      if (visibleReceipt) return visibleReceipt;
    }
    openChat();
    const fn = insertDomSelectionByWorkspaceRef.current.get(workspaceId);
    if (fn) fn(normalized);
    else pendingDomSelectionsByWorkspaceRef.current.set(workspaceId, [
      ...(pendingDomSelectionsByWorkspaceRef.current.get(workspaceId) ?? []),
      normalized,
    ]);
    return {
      status: fn ? 'delivered' : 'queued',
      target: dockTarget(workspaceId),
    };
  }, [deliverToActiveTarget, dockTarget, openChat, tryVisibleTarget]);

  const handleAddTabToChat = useCallback(async (
    workspaceId: string,
    tab: AgentContextTabRef,
  ): Promise<ChatDeliveryReceipt> => {
    if (deliverToActiveTarget) {
      const visibleReceipt = await tryVisibleTarget({ kind: 'tab', tab });
      if (visibleReceipt) return visibleReceipt;
    }
    openChat();
    const fn = insertTabByWorkspaceRef.current.get(workspaceId);
    if (fn) fn(tab);
    else pendingTabsByWorkspaceRef.current.set(workspaceId, [
      ...(pendingTabsByWorkspaceRef.current.get(workspaceId) ?? []),
      tab,
    ]);
    return {
      status: fn ? 'delivered' : 'queued',
      target: dockTarget(workspaceId),
    };
  }, [deliverToActiveTarget, dockTarget, openChat, tryVisibleTarget]);

  const handleStartSkillChat = useCallback(async (
    workspaceId: string,
    skillName: string,
  ): Promise<ChatDeliveryReceipt> => {
    if (deliverToActiveTarget) {
      const visibleReceipt = await tryVisibleTarget({ kind: 'skill', skillName });
      if (visibleReceipt) return visibleReceipt;
    }
    const fn = startSkillChatByWorkspaceRef.current.get(workspaceId);
    if (fn) {
      await fn(skillName);
      openChat();
      return { status: 'delivered', target: dockTarget(workspaceId) };
    }
    pendingSkillByWorkspaceRef.current.set(workspaceId, skillName);
    openChat();
    return { status: 'queued', target: dockTarget(workspaceId) };
  }, [deliverToActiveTarget, dockTarget, openChat, tryVisibleTarget]);

  const handleSubmitDomReviewComments = useCallback(async (
    workspaceId: string,
    comments: AgentContextDomReviewComment[],
  ): Promise<boolean> => {
    if (deliverToActiveTarget) {
      const visibleReceipt = await tryVisibleTarget({ kind: 'dom-review', comments });
      if (visibleReceipt) return visibleReceipt.status === 'delivered';
    }
    openChat();
    return await domReviewQueue.submit(workspaceId, comments);
  }, [deliverToActiveTarget, domReviewQueue, openChat, tryVisibleTarget]);

  /** Send a question about canvas nodes as a chat turn in that workspace. */
  const handleSubmitPrompt = useCallback(async (
    workspaceId: string,
    prompt: ChatPromptSubmission,
  ): Promise<ChatDeliveryReceipt> => {
    if (deliverToActiveTarget) {
      const visibleReceipt = await tryVisibleTarget({ kind: 'prompt', prompt });
      if (visibleReceipt) return visibleReceipt;
    }
    openChat();
    const submitted = await promptQueue.submit(workspaceId, prompt);
    return submitted
      ? { status: 'delivered', target: dockTarget(workspaceId) }
      : { status: 'failed', target: dockTarget(workspaceId) };
  }, [deliverToActiveTarget, dockTarget, openChat, promptQueue, tryVisibleTarget]);

  return {
    handleAddDomSelectionToChat,
    handleAddTabToChat,
    handleStartSkillChat,
    handleAddNodeToChat,
    handleAddPreviewNodeToChat,
    handleSubmitDomReviewComments,
    handleSubmitPrompt,
    registerInsertDomSelectionMention,
    registerInsertTabMention,
    registerInsertMention,
    registerStartSkillChat,
    registerSubmitDomReviewComments,
    registerSubmitPrompt,
  };
}
