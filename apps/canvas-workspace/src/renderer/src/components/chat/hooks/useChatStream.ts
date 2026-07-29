import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentChatMessage, AgentRequestContext, ChatImageAttachment } from '../../../types';
import type { AgentScope, PendingClarification, ToolCallStatus, WorkspaceOption } from '../types';
import { extractMentionedWorkspaceIds } from '../utils/mentions';
import { markToolResult, settleRunningTools, upsertToolInputStart } from './toolStreamState';
import { createTextDeltaBatcher } from './textDeltaBatcher';
import { subscribeVisualStream } from './visualStreamSubscription';
import {
  applyTurnCompletion,
  createRelayTurnHandlers,
  createSegmentState,
  type RelayProgress,
} from './relayTurnHandlers';
import { count } from '../../../perf/counters';

interface UseChatStreamOptions {
  agentScope: AgentScope;
  allWorkspaces?: WorkspaceOption[];
}

const agentScopeKey = (scope: AgentScope): string =>
  scope.kind === 'workspace' ? `workspace:${scope.workspaceId}`
    : scope.kind === 'scheduled' ? `scheduled:${scope.taskId}` : 'global';

export function useChatStream({ agentScope, allWorkspaces }: UseChatStreamOptions) {
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [streamingTools, setStreamingTools] = useState<ToolCallStatus[]>([]);
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());
  const [messageTools, setMessageTools] = useState<Map<number, ToolCallStatus[]>>(new Map());
  const [collapsedSections, setCollapsedSections] = useState<Set<number>>(new Set());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [relay, setRelay] = useState<RelayProgress | null>(null);
  const [pendingClarify, setPendingClarify] = useState<PendingClarification | null>(null);
  const [clarifyInput, setClarifyInput] = useState('');
  const toolIdCounter = useRef(0);
  const activeUnsubsRef = useRef<(() => void)[]>([]);
  const streamingMsgIdx = useRef(-1);

  const cleanupSubscriptions = useCallback(() => {
    for (const unsubscribe of activeUnsubsRef.current) {
      unsubscribe();
    }
    activeUnsubsRef.current = [];
  }, []);

  const scopeKey = agentScopeKey(agentScope);
  const workspaceId = agentScope.kind === 'workspace' ? agentScope.workspaceId : undefined;

  useEffect(() => {
    setActiveSessionId(null);
    setPendingClarify(null);
    setClarifyInput('');
    // A scope switch mid-turn unsubscribes the stream events below, so the
    // completion event that would normally reset these never arrives —
    // without this the new scope starts with a permanently spinning
    // composer and stale tool chips.
    setLoading(false);
    setStreamingTools([]);
    setRelay(null);
    streamingMsgIdx.current = -1;

    return cleanupSubscriptions;
  }, [cleanupSubscriptions, scopeKey]);

  const replaceMessages = useCallback((nextMessages: AgentChatMessage[]) => {
    setMessages(nextMessages);
    setMessageTools(new Map(
      nextMessages.flatMap((message, index) => (
        message.role === 'assistant' && message.toolCalls?.length
          ? [[index, message.toolCalls]] as Array<[number, ToolCallStatus[]]>
          : []
      )),
    ));
    setCollapsedSections(new Set(
      nextMessages.flatMap((message, index) => (
        message.role === 'assistant' && message.toolCalls?.length ? [index] : []
      )),
    ));
    // Tool ids are minted per turn; after a wholesale message swap the old
    // ids never come back, so drop their expansion state instead of letting
    // the set grow (and avoid stale chips from a superseded stream).
    setExpandedTools(new Set());
    setStreamingTools([]);
  }, []);

  const sendMessage = useCallback(async (rawText: string, requestContext?: AgentRequestContext, attachments: ChatImageAttachment[] = []) => {
    const text = rawText.trim();
    if ((!text && attachments.length === 0) || loading) return false;

    const userMessage: AgentChatMessage = {
      role: 'user',
      content: text,
      timestamp: Date.now(),
      attachments: attachments.length > 0 ? attachments : undefined,
    };

    setMessages(prev => [...prev, userMessage]);
    setLoading(true);

    try {
      const mentionedWorkspaceIds = workspaceId
        ? extractMentionedWorkspaceIds(text, allWorkspaces, workspaceId)
        : extractMentionedWorkspaceIds(text, allWorkspaces, '');
      const result = await window.canvasWorkspace.agent.chat(
        { scope: agentScope },
        text,
        mentionedWorkspaceIds.length > 0 ? mentionedWorkspaceIds : undefined,
        requestContext,
        attachments.length > 0 ? attachments : undefined,
      );

      if (!result.ok || !result.sessionId) {
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: `Error: ${result.error ?? 'Failed to start chat'}`,
            timestamp: Date.now(),
          },
        ]);
        setLoading(false);
        return false;
      }

      const sessionId = result.sessionId;
      // One turn = 1..N segments (a multi-role relay); each segment owns its
      // own bubble + tool list. Lifecycle lives in relayTurnHandlers.ts.
      const segment = createSegmentState();
      setActiveSessionId(sessionId);

      const ensureAssistantMessage = () => {
        if (segment.msgIndex >= 0) return;
        setMessages(prev => {
          if (segment.msgIndex >= 0) return prev;
          segment.msgIndex = prev.length;
          streamingMsgIdx.current = prev.length;
          return [...prev, { role: 'assistant', content: '', timestamp: Date.now() }];
        });
      };

      const cleanupTurn = () => {
        unsubscribeDelta();
        unsubscribeComplete();
        unsubscribeToolCall();
        unsubscribeToolResult();
        unsubscribeToolInputStart();
        unsubscribeToolInputDelta();
        unsubscribeToolInputEnd();
        unsubscribeVisualStream();
        unsubscribeClarify();
        unsubscribeRoleTurnStart();
        unsubscribeRoleTurnEnd();
        activeUnsubsRef.current = [];
      };

      const publishTools = () => {
        const snapshot = [...segment.tools];
        setStreamingTools(snapshot);
        if (segment.msgIndex >= 0) {
          setMessageTools(prev => new Map(prev).set(segment.msgIndex, snapshot));
        }
      };

      const textDeltaBatcher = createTextDeltaBatcher({
        // A fixed visual cadence avoids turning 120Hz+ displays back into
        // hundreds of whole-message Markdown parses per response. 32ms is
        // still perceptually continuous for generated text while leaving
        // most frames free for input, scrolling, and canvas work.
        schedule: callback => window.setTimeout(callback, 32),
        cancelScheduled: handle => window.clearTimeout(handle),
        onFlush: (delta) => {
          count('chat-stream-commit');
          setMessages(prev => {
            const index = segment.msgIndex;
            if (index < 0 || index >= prev.length) return prev;
            const next = [...prev];
            next[index] = { ...next[index], content: next[index].content + delta };
            return next;
          });
        },
      });

      const findTool = (toolCallId: string | undefined, name?: string) => {
        if (toolCallId) {
          const byId = segment.tools.find(t => t.toolCallId === toolCallId);
          if (byId) return byId;
        }
        if (name) {
          return segment.tools.find(t => t.name === name && t.status === 'running');
        }
        return undefined;
      };

      // Input streaming: starts BEFORE the LLM has finished emitting tool args.
      // We create the ToolCallStatus here so the chat UI can render a
      // progressive preview (e.g. a streaming inline visual) keyed off the
      // toolCallId before the final tool-call chunk arrives.
      const unsubscribeToolInputStart = window.canvasWorkspace.agent.onToolInputStart(sessionId, data => {
        ensureAssistantMessage();
        upsertToolInputStart(segment.tools, data, () => ++toolIdCounter.current);
        publishTools();
      });

      const unsubscribeToolInputDelta = window.canvasWorkspace.agent.onToolInputDelta(sessionId, data => {
        const tool = findTool(data.id);
        if (!tool) return;
        tool.partialInput = (tool.partialInput ?? '') + data.delta;
        publishTools();
      });

      const unsubscribeToolInputEnd = window.canvasWorkspace.agent.onToolInputEnd(sessionId, data => {
        const tool = findTool(data.id);
        if (!tool) return;
        tool.inputStreaming = false;
        publishTools();
      });

      // Side-channel visual_render chunks (see visualStreamSubscription.ts).
      const unsubscribeVisualStream = subscribeVisualStream({ workspaceId, findTool, publishTools });

      const unsubscribeToolCall = window.canvasWorkspace.agent.onToolCall(sessionId, data => {
        ensureAssistantMessage();
        // If we already created a ToolCallStatus for this id during input
        // streaming, merge the fully-parsed args in. Otherwise (e.g. a model
        // that doesn't stream tool input), create one now.
        const existing = findTool(data.toolCallId, data.name);
        if (existing) {
          existing.args = data.args;
          existing.inputStreaming = false;
        } else {
          segment.tools.push({
            id: ++toolIdCounter.current,
            name: data.name,
            args: data.args,
            toolCallId: data.toolCallId,
            status: 'running',
          });
        }
        publishTools();
      });

      const unsubscribeToolResult = window.canvasWorkspace.agent.onToolResult(sessionId, data => {
        markToolResult(segment.tools, data);
        publishTools();
      });

      const unsubscribeDelta = window.canvasWorkspace.agent.onTextDelta(sessionId, delta => {
        ensureAssistantMessage();
        count('chat-stream-delta');
        textDeltaBatcher.push(delta);
      });

      const unsubscribeClarify = window.canvasWorkspace.agent.onClarifyRequest(sessionId, request => {
        ensureAssistantMessage();
        setPendingClarify({ id: request.id, question: request.question, context: request.context });
        setClarifyInput('');
      });

      const segmentHandlers = createRelayTurnHandlers({
        segment,
        streamingMsgIdx,
        flushDeltas: () => textDeltaBatcher.flush(),
        setMessages,
        setMessageTools,
        setCollapsedSections,
        setStreamingTools,
        setRelay,
      });
      const unsubscribeRoleTurnStart = window.canvasWorkspace.agent.onRoleTurnStart(
        sessionId, segmentHandlers.handleRoleTurnStart,
      );
      const unsubscribeRoleTurnEnd = window.canvasWorkspace.agent.onRoleTurnEnd(
        sessionId, segmentHandlers.handleRoleTurnEnd,
      );

      const unsubscribeComplete = window.canvasWorkspace.agent.onChatComplete(sessionId, completeResult => {
        textDeltaBatcher.flush();
        cleanupTurn();
        settleRunningTools(segment.tools);
        const toolSnapshot = segment.tools.length > 0 ? segment.tools.map(tool => ({ ...tool })) : undefined;
        if (segment.msgIndex >= 0 && toolSnapshot) {
          setCollapsedSections(prev => new Set(prev).add(segment.msgIndex));
        }

        // Frozen segments (role-turn-end) are final; this only settles a
        // still-in-flight bubble or appends an error message.
        applyTurnCompletion({ completeResult, segment, toolSnapshot, setMessages });

        setStreamingTools([]);
        setExpandedTools(new Set());
        setRelay(null);
        streamingMsgIdx.current = -1;
        setActiveSessionId(null);
        setPendingClarify(null);
        setClarifyInput('');
        setLoading(false);
      });

      activeUnsubsRef.current.push(
        unsubscribeToolCall,
        unsubscribeToolResult,
        unsubscribeToolInputStart,
        unsubscribeToolInputDelta,
        unsubscribeToolInputEnd,
        unsubscribeVisualStream,
        unsubscribeDelta,
        unsubscribeComplete,
        unsubscribeClarify,
        unsubscribeRoleTurnStart,
        unsubscribeRoleTurnEnd,
        textDeltaBatcher.cancel,
      );

      return true;
    } catch (error) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `Error: ${String(error)}`,
          timestamp: Date.now(),
        },
      ]);
      setLoading(false);
      setActiveSessionId(null);
      setRelay(null);
      setPendingClarify(null);
      setClarifyInput('');
      return false;
    }
  }, [agentScope, allWorkspaces, loading, workspaceId]);


  const addImageToCanvas = useCallback(async (imagePath: string, title?: string) => {
    if (!workspaceId) return;
    const result = await window.canvasWorkspace.agent.addImageToCanvas(workspaceId, imagePath, title);
    if (!result.ok) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `Error adding image to canvas: ${result.error ?? 'Unknown error'}`,
          timestamp: Date.now(),
        },
      ]);
    }
  }, [workspaceId]);

  /** Graceful relay stop: current speaker finishes, queued speakers are skipped. */
  const stopRelay = useCallback(async () => {
    const sessionId = activeSessionId;
    if (!sessionId) return;
    setRelay(prev => (prev ? { ...prev, stopping: true } : prev));
    try {
      await window.canvasWorkspace.agent.stopRelay(sessionId);
    } catch (error) {
      console.error('[chat-panel] stop-relay failed:', error);
    }
  }, [activeSessionId]);

  const abort = useCallback(async () => {
    const sessionId = activeSessionId;
    if (!sessionId) return;

    setPendingClarify(null);
    setClarifyInput('');

    try {
      await window.canvasWorkspace.agent.abort(sessionId);
    } catch (error) {
      console.error('[chat-panel] abort failed:', error);
    }
  }, [activeSessionId]);

  const answerClarification = useCallback(async () => {
    const pending = pendingClarify;
    const sessionId = activeSessionId;
    if (!pending || !sessionId) return;

    const answer = clarifyInput.trim();
    if (!answer) return;

    setPendingClarify(null);
    setClarifyInput('');

    try {
      await window.canvasWorkspace.agent.answerClarification(sessionId, pending.id, answer);
    } catch (error) {
      console.error('[chat-panel] clarification answer failed:', error);
    }
  }, [activeSessionId, clarifyInput, pendingClarify]);

  /**
   * Drop the conversation tail at and after `fromIndex` in both the
   * renderer's local state and the main-process session, so the next
   * `sendMessage` starts from a clean prefix. Used by edit / regenerate.
   */
  const rewindTo = useCallback(async (fromIndex: number): Promise<boolean> => {
    if (loading) return false;
    if (fromIndex < 0) return false;
    setMessages(prev => (fromIndex < prev.length ? prev.slice(0, fromIndex) : prev));
    setMessageTools(prev => {
      const next = new Map<number, ToolCallStatus[]>();
      prev.forEach((tools, idx) => {
        if (idx < fromIndex) next.set(idx, tools);
      });
      return next;
    });
    setCollapsedSections(prev => {
      const next = new Set<number>();
      prev.forEach(idx => {
        if (idx < fromIndex) next.add(idx);
      });
      return next;
    });
    try {
      const result = await window.canvasWorkspace.agent.rewindMessages({ scope: agentScope }, fromIndex);
      return !!result?.ok;
    } catch (error) {
      console.error('[chat-panel] rewind failed:', error);
      return false;
    }
  }, [agentScope, loading]);

  /**
   * Replace the user message at `userIndex` with `newContent` and
   * re-run the turn. Drops every message at and after `userIndex` first.
   */
  const editUserMessage = useCallback(async (
    userIndex: number,
    newContent: string,
    requestContext?: AgentRequestContext,
  ): Promise<boolean> => {
    const trimmed = newContent.trim();
    if (!trimmed || loading) return false;
    const original = messages[userIndex];
    if (!original || original.role !== 'user') return false;
    const ok = await rewindTo(userIndex);
    if (!ok) return false;
    return await sendMessage(trimmed, requestContext, original.attachments ?? []);
  }, [loading, messages, rewindTo, sendMessage]);

  /**
   * Regenerate the assistant reply at `assistantIndex` by replaying the
   * preceding user turn. Drops both messages (and everything after)
   * before re-sending.
   */
  const regenerateAssistantMessage = useCallback(async (
    assistantIndex: number,
    requestContext?: AgentRequestContext,
  ): Promise<boolean> => {
    if (loading) return false;
    const assistant = messages[assistantIndex];
    if (!assistant || assistant.role !== 'assistant') return false;
    // Walk back to the most recent user turn that triggered this reply.
    let userIndex = assistantIndex - 1;
    while (userIndex >= 0 && messages[userIndex].role !== 'user') userIndex--;
    if (userIndex < 0) return false;
    const userMessage = messages[userIndex];
    const ok = await rewindTo(userIndex);
    if (!ok) return false;
    return await sendMessage(userMessage.content, requestContext, userMessage.attachments ?? []);
  }, [loading, messages, rewindTo, sendMessage]);

  const toggleSection = useCallback((messageIndex: number) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(messageIndex)) next.delete(messageIndex);
      else next.add(messageIndex);
      return next;
    });
  }, []);

  const toggleToolExpand = useCallback((toolId: number) => {
    setExpandedTools(prev => {
      const next = new Set(prev);
      if (next.has(toolId)) next.delete(toolId);
      else next.add(toolId);
      return next;
    });
  }, []);

  return {
    abort,
    relay,
    stopRelay,
    addImageToCanvas,
    answerClarification,
    clarifyInput,
    collapsedSections,
    editUserMessage,
    expandedTools,
    loading,
    messageTools,
    messages,
    pendingClarify,
    regenerateAssistantMessage,
    replaceMessages,
    sendMessage,
    setClarifyInput,
    streamingTools,
    toggleSection,
    toggleToolExpand,
  };
}
