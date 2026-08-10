import type { InkCoderController } from './ink-controller.js';
import type { FileGoalPluginService } from 'pulse-coder-plugin-kit/goal';
import { estimateTokens, publishSession, resolveCurrentSessionId, syncSessionTaskListBinding } from './controller-session.js';
import { extractStepUsage } from '../shared/usage-metrics.js';
import { buildMemoryRunContext, memoryIntegration, recordDailyLogFromSuccessPath } from '../shared/memory-integration.js';
import { goalIntegration } from '../shared/goal-integration.js';
import { expandFileReferences } from '../shared/file-reference.js';
import { modelRunOptions, currentContextWindow } from './controller-model.js';
import { dispatchInput } from './controller-dispatch.js';
import { decideGoalContinuation } from './controller-goal.js';
import { getToolCallId, getToolInput, getToolOutput, resolveToolName } from './tool-payload.js';

/** Run machinery for the Ink host: the agent turn, exclusive commands,
 *  queued-input draining, and per-step usage accounting. */

export async function runMessage(controller: InkCoderController, rawInput: string): Promise<void> {
  // The transcript shows what the user typed; the model additionally gets the
  // contents of any @referenced files appended below it.
  controller.ui.user(rawInput);

  const expansion = await expandFileReferences(rawInput);
  if (expansion.attached.length > 0) {
    controller.ui.log(`Attached ${expansion.attached.length} reference${expansion.attached.length === 1 ? '' : 's'}: ${expansion.attached.join(', ')}`);
  }
  for (const skipped of expansion.skipped) {
    controller.ui.log(`[warn] @${skipped.ref} skipped — ${skipped.reason}`);
  }
  let messageInput = expansion.text;

  controller.ui.session({
    sessionId: controller.sessionCommands.getCurrentSessionId(),
    taskListId: controller.sessionCommands.getCurrentTaskListId(),
    messages: controller.context.messages.length,
    estimatedTokens: estimateTokens(controller, controller.context.messages),
    mode: controller.interactionMode,
  });

  if (controller.context.messages.length === 0) {
    // Title from what the user typed, never from injected file contents.
    await controller.sessionCommands.maybeAutoTitle(rawInput);
  }

  controller.context.messages.push({
    role: 'user',
    content: messageInput,
  });

  controller.ui.startProcessing('Running agent');

  const ac = new AbortController();
  controller.currentAbortController = ac;
  controller.isProcessing = true;

  let sawText = false;
  let toolCalls = 0;
  const runStartedAt = Date.now();

  try {
    await syncSessionTaskListBinding(controller);
    const currentSessionId = resolveCurrentSessionId(controller);

    const runAgent = async () => controller.agent.run(controller.context, {
      abortSignal: ac.signal,
      ...modelRunOptions(controller),
      onCompactionStart: () => {
        controller.ui.log('Compacting context (summarizing older turns)…');
        controller.ui.updateSnapshot({ status: 'Compacting context…', phase: 'Compacting' });
      },
      // Aborting does not stop the model mid-flight: the current step keeps
      // delivering text and tool events until it unwinds. Writing those to
      // the bridge after the user was told the request was cancelled puts
      // answer fragments and spinning tool lines under a Cancelled status,
      // so every streaming callback stops at the signal.
      onText: (delta) => {
        if (ac.signal.aborted) {
          return;
        }
        sawText = true;
        controller.ui.text(delta);
      },
      onToolInputStart: ({ id, toolName }) => {
        if (ac.signal.aborted) {
          return;
        }
        controller.ui.toolInputStart(id, toolName);
      },
      onToolInputDelta: ({ id, delta }) => {
        if (ac.signal.aborted) {
          return;
        }
        controller.ui.toolInputDelta(id, delta);
      },
      onToolInputEnd: ({ id }) => {
        if (ac.signal.aborted) {
          return;
        }
        controller.ui.toolInputEnd(id);
      },
      onToolCall: (toolCall) => {
        if (ac.signal.aborted) {
          return;
        }
        toolCalls += 1;
        const input = getToolInput(toolCall);
        controller.ui.toolCall(resolveToolName(toolCall), input, getToolCallId(toolCall));
      },
      onToolResult: (toolResult) => {
        if (ac.signal.aborted) {
          return;
        }
        const record = toolResult as Record<string, unknown>;
        controller.ui.toolResult(resolveToolName(record), getToolOutput(record), getToolCallId(record));
      },
      onStepFinish: (step) => {
        // Usage still counts: those tokens were spent whether or not the
        // answer they paid for is shown.
        recordStepUsage(controller, step);
        if (ac.signal.aborted) {
          return;
        }
        controller.ui.stepFinished(step.finishReason);
      },
      onClarificationRequest: async (request) => {
        return await controller.inputManager.requestInput(request);
      },
      onCompacted: (newMessages, event) => {
        const beforeMessages = controller.context.messages.length;
        const beforeTokens = estimateTokens(controller, controller.context.messages);
        controller.context.messages = newMessages;
        const afterTokens = estimateTokens(controller, newMessages);
        const reason = (event as { reason?: string } | undefined)?.reason;
        controller.ui.info(`Context compacted · ${beforeMessages} → ${newMessages.length} messages · ~${beforeTokens} → ~${afterTokens} tokens${reason ? ` (${reason})` : ''}`);
        controller.ui.updateSnapshot({ status: 'Running agent', phase: 'Running' });
      },
      onResponse: (messages) => {
        controller.context.messages.push(...messages);
      },
    });

    // Goal-driven continuation: after each round, the goal service decides
    // whether to auto-continue, verify, or ask the user. The engine itself is
    // never asked to loop — the CLI owns the budget.
    let round = 0;
    while (true) {
      round += 1;
      sawText = false;
      toolCalls = 0;

      const result = currentSessionId
        ? await memoryIntegration.withRunContext(
          buildMemoryRunContext({
            sessionId: currentSessionId,
            userText: messageInput,
          }),
          runAgent,
        )
        : await runAgent();

      // The engine does not throw on abort: once the signal fires, loop() returns
      // the plain sentinel string 'Request aborted.' as an ordinary result, so the
      // AbortError catch below never sees an engine-side cancellation. Without this
      // check the success path would finalize the partial answer as final, write a
      // "Done in Xs" summary, print the sentinel as the model's reply, and persist
      // the cancelled turn to the session and the daily log.
      if (ac.signal.aborted) {
        controller.ui.abort('Operation cancelled.');
        return;
      }

      controller.ui.runSummary({
        elapsedMs: Date.now() - runStartedAt,
        toolCalls,
        messages: controller.context.messages.length,
        estimatedTokens: estimateTokens(controller, controller.context.messages),
        mode: controller.interactionMode,
      });

      if (result) {
        if (!sawText) {
          controller.ui.plain(result);
        }

        await controller.sessionCommands.saveContext(controller.context);

        if (currentSessionId) {
          await recordDailyLogFromSuccessPath({
            sessionId: currentSessionId,
            userText: messageInput,
            assistantText: result,
          });
        }
      }

      const decision = await decideGoalContinuation(controller, getGoalService(controller));
      if (decision.action === 'stop') {
        break;
      }

      // Continue: push the next round's instruction and loop. The message is a
      // plain user turn, so the next round flows through the exact same
      // pipeline (prompt injection, tool loop, session save) as the first.
      controller.ui.info(`Goal continuation round ${round + 1}`);
      controller.context.messages.push({
        role: 'user',
        content: decision.message,
      });
      messageInput = decision.message;
    }
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      controller.ui.abort('Operation cancelled.');
    } else {
      controller.ui.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  } finally {
    controller.isProcessing = false;
    controller.currentAbortController = null;
    publishSession(controller, 'Ready');

    drainQueuedInput(controller);
  }
}

export async function runExclusive(controller: InkCoderController, task: () => Promise<unknown>): Promise<void> {
  controller.isProcessing = true;
  controller.ui.startProcessing('Running command');
  try {
    await task();
    publishSession(controller, 'Ready');
  } catch (error) {
    controller.ui.error(`Command error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    controller.isProcessing = false;
    controller.ui.stopProcessing();
    drainQueuedInput(controller);
  }
}

/**
 * Runs the next queued input, if any. Every path that finishes a piece of
 * work calls this — agent runs, exclusive commands, and command dispatch —
 * so anything typed while one was in flight runs next, in the order it was
 * typed, instead of waiting for the user to send another message.
 *
 * Nested callers are the normal case (a command's dispatch finally fires
 * right after `runExclusive`'s own finally), so the drain is guarded: while
 * one is scheduled the rest are no-ops. Without it both would shift an entry
 * and the second would land on an already-busy controller and re-queue it at
 * the BACK, reordering exactly what the queue exists to preserve.
 */
export function drainQueuedInput(controller: InkCoderController): void {
  if (controller.drainScheduled || controller.isShuttingDown || controller.queuedInputs.length === 0) {
    return;
  }

  controller.drainScheduled = true;
  setImmediate(() => {
    controller.drainScheduled = false;
    // Taken here, not at schedule time: Esc discards the queue, and an entry
    // already pulled out of it would run after the user was told it was
    // dropped.
    const nextInput = controller.queuedInputs.shift();
    if (!nextInput) {
      return;
    }
    controller.ui.info('Running queued input...');
    // The status line counts the queue, so it has to shrink with it — a
    // command dispatch does not otherwise publish a session snapshot.
    controller.ui.updateSnapshot({ queuedInputs: controller.queuedInputs.length });
    void controller.submitInput(nextInput);
  });
}

export function recordStepUsage(controller: InkCoderController, step: unknown): void {
  const usage = extractStepUsage(step);

  if (usage.inputTokens !== undefined) {
    controller.lastContextTokens = usage.inputTokens;
    controller.totalInputTokens += usage.inputTokens;
  }
  if (usage.outputTokens !== undefined) {
    controller.totalOutputTokens += usage.outputTokens;
  }
  if (usage.cachedInputTokens !== undefined) {
    controller.lastCachedTokens = usage.cachedInputTokens;
    controller.totalCachedTokens += usage.cachedInputTokens;
  }

  controller.ui.usage({
    inputTokens: controller.lastContextTokens,
    outputTokens: controller.totalOutputTokens,
    cachedInputTokens: controller.lastCachedTokens,
  });
}

function getGoalService(controller: InkCoderController): FileGoalPluginService {
  const fromEngine = controller.agent.getService<FileGoalPluginService>('goalService');
  if (fromEngine) {
    return fromEngine;
  }
  // Engine plugin missing (e.g. a host that assembled plugins by hand): fall
  // back to the CLI-side singleton so continuation still works.
  return goalIntegration.service;
}

export function describeCacheHit(controller: InkCoderController): string {
  if (controller.lastCachedTokens === undefined) {
    return 'n/a (provider reports no cache usage)';
  }

  const lastPct = controller.lastContextTokens > 0 ? Math.round(controller.lastCachedTokens / controller.lastContextTokens * 100) : 0;
  const sessionPct = controller.totalInputTokens > 0 ? Math.round(controller.totalCachedTokens / controller.totalInputTokens * 100) : 0;
  return `last ${lastPct}% (${controller.lastCachedTokens}/${controller.lastContextTokens}) · session ${sessionPct}% (${controller.totalCachedTokens}/${controller.totalInputTokens})`;
}
