import { buildModelRunOptions } from '../models/model-run-options.js';
import { buildMemoryRunContext, memoryIntegration, recordDailyLogFromSuccessPath } from '../shared/memory-integration.js';
import { estimateTokens, resolveCurrentSessionId, syncSessionTaskListBinding, type ReadlineHost } from './host-context.js';

/**
 * One user message → one engine run, including the session banner, run
 * callbacks, the abort-sentinel check, the run summary, session save and
 * daily-log capture. Queue/abort state stays with the caller's input loop.
 */
export async function executeAgentTurn(host: ReadlineHost, messageInput: string, ac: AbortController): Promise<void> {
  // Regular message processing
  host.tui.session({
    sessionId: host.sessionCommands.getCurrentSessionId(),
    taskListId: host.sessionCommands.getCurrentTaskListId(),
    messages: host.context.messages.length,
    estimatedTokens: estimateTokens(host.context.messages),
    mode: host.agent.getMode(),
  });

  if (host.context.messages.length === 0) {
    await host.sessionCommands.maybeAutoTitle(messageInput);
  }

  host.context.messages.push({
    role: 'user',
    content: messageInput,
  });


  host.tui.startProcessing('Running agent');

  let sawText = false;
  let toolCalls = 0;
  const runStartedAt = Date.now();

  const getToolInput = (toolCall: Record<string, unknown>): unknown => {
    const input = (toolCall as { input?: unknown }).input;
    if (input !== undefined) {
      return input;
    }
    const args = (toolCall as { args?: unknown }).args;
    if (args !== undefined) {
      return args;
    }
    return undefined;
  };

  const resolveToolName = (payload: Record<string, unknown>): string => {
    const name = (payload as { toolName?: unknown }).toolName
      ?? (payload as { name?: unknown }).name
      ?? (payload as { tool?: unknown }).tool
      ?? (payload as { title?: unknown }).title
      ?? (payload as { kind?: unknown }).kind;
    if (typeof name === 'string' && name.trim()) {
      return name;
    }
    const toolCallId = (payload as { toolCallId?: unknown }).toolCallId;
    if (typeof toolCallId === 'string' && toolCallId.trim()) {
      return toolCallId;
    }
    return 'tool';
  };

  try {
    await syncSessionTaskListBinding(host);

    const currentSessionId = resolveCurrentSessionId(host);

    // Registry-resolved, so a provider-bound spec (`deepseek:v4`) carries its
    // baseUrl/apiKey/contextWindow here exactly as it does in the Ink host.
    const runAgent = async () => host.agent.run(host.context, {
      abortSignal: ac.signal,
      ...buildModelRunOptions(host.modelChoice, process.env, {
        sessionId: host.sessionCommands.getCurrentSessionId(),
      }),
      onText: (delta) => {
        sawText = true;
        host.tui.text(delta);
      },
      onToolCall: (toolCall) => {
        toolCalls += 1;
        const input = getToolInput(toolCall);
        host.tui.toolCall(resolveToolName(toolCall), input);
      },
      onToolResult: (toolResult) => {
        const toolName = resolveToolName(toolResult as Record<string, unknown>);
        host.tui.toolResult(toolName);
      },
      onStepFinish: (step) => {
        host.tui.stepFinished(step.finishReason);
      },
      onClarificationRequest: async (request) => {
        return await host.inputManager.requestInput(request);
      },
      onCompacted: (newMessages) => {
        host.context.messages = newMessages;
      },
      onResponse: (messages) => {
        host.context.messages.push(...messages);
      },
    });
    const result = currentSessionId
      ? await memoryIntegration.withRunContext(
        buildMemoryRunContext({
          sessionId: currentSessionId,
          userText: messageInput,
        }),
        runAgent,
      )
      : await runAgent();

    // The engine does not throw on abort: loop() returns the plain sentinel
    // string 'Request aborted.' as an ordinary result, so the AbortError catch
    // below never sees an engine-side cancellation. Without this check the
    // success path would print that sentinel as the model's reply and persist
    // the cancelled turn to the session and the daily log.
    if (ac.signal.aborted) {
      host.tui.abort('Operation cancelled.');
      return;
    }

    host.tui.runSummary({
      elapsedMs: Date.now() - runStartedAt,
      toolCalls,
      messages: host.context.messages.length,
      estimatedTokens: estimateTokens(host.context.messages),
      mode: host.agent.getMode(),
    });

    if (result) {
      if (!sawText) {
        host.tui.plain(result);
      } else {
        host.tui.plain();
      }

      await host.sessionCommands.saveContext(host.context);

      if (currentSessionId) {
        await recordDailyLogFromSuccessPath({
          sessionId: currentSessionId,
          userText: messageInput,
          assistantText: result,
        });
      }
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      host.tui.abort('Operation cancelled.');
    } else {
      host.tui.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
