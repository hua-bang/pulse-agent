import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentChatMessage, AgentRequestContext, ChatImageAttachment } from '../../../types';
import type { AgentScope, PendingClarification, ToolCallStatus, WorkspaceOption } from '../types';
import { extractMentionedWorkspaceIds } from '../utils/mentions';

interface UseChatStreamOptions {
  agentScope: AgentScope;
  allWorkspaces?: WorkspaceOption[];
}

const agentScopeKey = (scope: AgentScope): string =>
  scope.kind === 'global' ? 'global' : `workspace:${scope.workspaceId}`;

export function useChatStream({ agentScope, allWorkspaces }: UseChatStreamOptions) {
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [streamingTools, setStreamingTools] = useState<ToolCallStatus[]>([]);
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());
  const [messageTools, setMessageTools] = useState<Map<number, ToolCallStatus[]>>(new Map());
  const [collapsedSections, setCollapsedSections] = useState<Set<number>>(new Set());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
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
      const assistantIndex = { current: -1 };
      const toolCalls: ToolCallStatus[] = [];
      setActiveSessionId(sessionId);

      const ensureAssistantMessage = () => {
        if (assistantIndex.current >= 0) return;
        setMessages(prev => {
          if (assistantIndex.current >= 0) return prev;
          assistantIndex.current = prev.length;
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
        activeUnsubsRef.current = [];
      };

      const publishTools = () => {
        const snapshot = [...toolCalls];
        setStreamingTools(snapshot);
        if (assistantIndex.current >= 0) {
          setMessageTools(prev => new Map(prev).set(assistantIndex.current, snapshot));
        }
      };

      const findTool = (toolCallId: string | undefined, name?: string) => {
        if (toolCallId) {
          const byId = toolCalls.find(t => t.toolCallId === toolCallId);
          if (byId) return byId;
        }
        if (name) {
          return toolCalls.find(t => t.name === name && t.status === 'running');
        }
        return undefined;
      };

      // Input streaming: starts BEFORE the LLM has finished emitting tool args.
      // We create the ToolCallStatus here so the chat UI can render a
      // progressive preview (e.g. a streaming inline visual) keyed off the
      // toolCallId before the final tool-call chunk arrives.
      const unsubscribeToolInputStart = window.canvasWorkspace.agent.onToolInputStart(sessionId, data => {
        ensureAssistantMessage();
        toolCalls.push({
          id: ++toolIdCounter.current,
          name: data.toolName,
          toolCallId: data.id,
          status: 'running',
          partialInput: '',
          inputStreaming: true,
        });
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

      // Side-channel: visual_render pushes already-extracted content as the
      // tool chunks its final HTML over animation frames. We accept these
      // chunks regardless of which session emitted them — the toolCallId
      // disambiguates — but filter to the active workspace so a stray
      // chunk from a parallel workspace agent doesn't leak in.
      let visualStreamFrames = 0;
      const unsubscribeVisualStream = window.canvasWorkspace.agent.onVisualStream(data => {
        if (!workspaceId || data.workspaceId !== workspaceId) return;
        const tool = findTool(data.toolCallId);
        if (!tool) {
          if (visualStreamFrames < 3) {
            console.warn('[useChatStream] visual-stream frame for unknown toolCallId', data.toolCallId);
            visualStreamFrames++;
          }
          return;
        }
        visualStreamFrames++;
        // Sample-log progress so we can verify chunks arrive at ~60fps.
        if (visualStreamFrames === 1 || data.done || visualStreamFrames % 15 === 0) {
          console.info(
            `[useChatStream] visual-stream frame=${visualStreamFrames} ` +
            `bytes=${data.content.length} done=${!!data.done} toolCallId=${data.toolCallId}`,
          );
        }
        tool.streamedContent = data.content;
        if (data.done) tool.streamedDone = true;
        publishTools();
      });

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
          toolCalls.push({
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
        const tool = findTool(data.toolCallId, data.name);
        if (tool) {
          tool.status = 'done';
          tool.result = data.result;
          tool.inputStreaming = false;
          // Safety: if the tool already pushed visual stream chunks but
          // the final `done` frame hasn't landed yet (IPC ordering race
          // between visual-stream and tool-result channels), promote the
          // last chunk to "done" so the renderer can swap to the final
          // script-enabled iframe instead of getting stuck in streaming
          // view.
          if (tool.streamedContent != null) {
            tool.streamedDone = true;
          }
        }
        publishTools();
      });

      const unsubscribeDelta = window.canvasWorkspace.agent.onTextDelta(sessionId, delta => {
        ensureAssistantMessage();
        setMessages(prev => {
          const index = assistantIndex.current;
          if (index < 0 || index >= prev.length) return prev;
          const next = [...prev];
          next[index] = { ...next[index], content: next[index].content + delta };
          return next;
        });
      });

      const unsubscribeClarify = window.canvasWorkspace.agent.onClarifyRequest(sessionId, request => {
        ensureAssistantMessage();
        setPendingClarify({ id: request.id, question: request.question, context: request.context });
        setClarifyInput('');
      });

      const unsubscribeComplete = window.canvasWorkspace.agent.onChatComplete(sessionId, completeResult => {
        cleanupTurn();
        if (assistantIndex.current >= 0 && toolCalls.length > 0) {
          setCollapsedSections(prev => new Set(prev).add(assistantIndex.current));
        }

        setStreamingTools([]);
        setExpandedTools(new Set());
        streamingMsgIdx.current = -1;
        setActiveSessionId(null);
        setPendingClarify(null);
        setClarifyInput('');

        const toolSnapshot = toolCalls.length > 0 ? toolCalls.map(tool => ({ ...tool })) : undefined;
        const mergeAssistantMessage = (message: AgentChatMessage): AgentChatMessage => (
          {
            ...message,
            toolCalls: toolSnapshot ?? message.toolCalls,
            runId: completeResult.runId ?? message.runId,
          }
        );

        if (!completeResult.ok) {
          setMessages(prev => {
            if (assistantIndex.current < 0) {
              return [
                ...prev,
                mergeAssistantMessage({
                  role: 'assistant',
                  content: `Error: ${completeResult.error ?? 'Unknown error'}`,
                  timestamp: Date.now(),
                }),
              ];
            }

            const next = [...prev];
            const index = assistantIndex.current;
            const existingContent = next[index]?.content;
            next[index] = mergeAssistantMessage({
              ...next[index],
              content: existingContent || `Error: ${completeResult.error ?? 'Unknown error'}`,
            });
            return next;
          });
        } else if (completeResult.response) {
          setMessages(prev => {
            if (assistantIndex.current < 0) {
              return [
                ...prev,
                mergeAssistantMessage({
                  role: 'assistant',
                  content: completeResult.response ?? '',
                  timestamp: Date.now(),
                }),
              ];
            }

            const next = [...prev];
            next[assistantIndex.current] = mergeAssistantMessage({
              ...next[assistantIndex.current],
              content: completeResult.response ?? '',
            });
            return next;
          });
        } else if (toolSnapshot && assistantIndex.current >= 0) {
          setMessages(prev => {
            const index = assistantIndex.current;
            if (index < 0 || index >= prev.length) return prev;
            const next = [...prev];
            next[index] = mergeAssistantMessage(next[index]);
            return next;
          });
        }

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
