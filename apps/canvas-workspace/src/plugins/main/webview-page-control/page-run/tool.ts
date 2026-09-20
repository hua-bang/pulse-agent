import { deliverPageResult } from './reading-output';
import type { CanvasTool, CanvasToolExecutionContext } from '../../../../main/agent/tools/types';
import { requestAskModeApproval } from '../../../../main/agent/tool-policy';
import { createBudget, remainingBudget } from './budget';
import { openPageRunBrowser } from './browser';
import { createJevDecision } from './decision';
import { runPageTask } from './runner';
import { generateFieldText } from './text';
import { pageRunInputSchema, PageRunStop, type PageAction, type PageRunPorts, type PageRunResult } from './types';

export async function approvePageAction(nodeId: string, action: PageAction, text: string | undefined, step: number, context: CanvasToolExecutionContext | undefined, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted();
  const name = action.kind === 'fill' ? 'page_fill'
    : action.kind === 'click' ? 'page_click'
      : action.kind === 'enter' || action.kind === 'escape' ? 'page_press' : 'page_scroll';
  const result = await requestAskModeApproval({
    name, operation: 'write',
    input: { nodeId, action: action.kind, target: action.target?.name ?? action.scrollArea?.name, value: text },
    context: {
      ...context, abortSignal: signal,
      toolCallId: `${context?.toolCallId ?? 'page_run'}:step:${step}`,
      // Never let an outer receipt imply approval of an unseen child action.
      runContext: { ...context?.runContext, approvalGrantedFor: undefined },
      onClarificationRequest: context?.onClarificationRequest
        ? request => context.onClarificationRequest!({ ...request, timeout: Math.max(1, Math.min(request.timeout, remainingBudget(signal))) })
        : undefined,
    },
  });
  signal.throwIfAborted();
  return result.approved;
}

export interface PageRunToolDependencies {
  open: typeof openPageRunBrowser;
  decision: typeof createJevDecision;
  text: PageRunPorts['text'];
}

export function createPageRunTool(workspaceId: string, dependencies: PageRunToolDependencies = {
  open: openPageRunBrowser, decision: createJevDecision, text: generateFieldText,
}): CanvasTool {
  return {
    name: 'page_run',
    defer_loading: true,
    description: 'Complete a bounded task in an existing web tab using Jev decisions. Pass nodeId and goal. Supports click, fill, keys and page/region scroll. Use mode=read for document traversal with fewer Jev requests; act for clicks/forms. Large results include ordered reading.parts: read every file before summarizing. If a click opens another tab, returns handoff plus openedPages: read/continue there instead of repeating the click. Returns evidence, not verified success. Requires TypeSafe Jev in Settings > Tools.',
    inputSchema: pageRunInputSchema,
    async execute(raw, context) {
      const parsed = pageRunInputSchema.safeParse(raw);
      if (!parsed.success) return JSON.stringify({ status: 'error', verified: false, reason: 'Invalid page_run input.' });
      const key = process.env.TYPESAFE_API_KEY?.trim();
      if (!key) return JSON.stringify({ status: 'error', verified: false, reason: 'Configure TypeSafe Jev in Settings > Tools, or set TYPESAFE_API_KEY, to enable page_run.' });
      const budget = createBudget(parsed.data.timeoutMs, context?.abortSignal);
      let browser: Awaited<ReturnType<typeof openPageRunBrowser>> | undefined;
      const started = Date.now();
      try {
        browser = await dependencies.open(workspaceId, parsed.data.nodeId, budget.signal);
        const result = await runPageTask(parsed.data, {
          ...browser,
          decide: dependencies.decision(key),
          text: dependencies.text,
          approve: (action, text, step, signal) => approvePageAction(parsed.data.nodeId, action, text, step, context, signal),
        }, budget.signal);
        return await deliverPageResult(workspaceId, result);
      } catch (error) {
        const cause = budget.signal.aborted ? budget.signal.reason : error;
        const result: PageRunResult = {
          status: cause instanceof PageRunStop ? cause.status : 'error',
          reason: cause instanceof PageRunStop ? cause.message : 'Unable to initialize page_run.',
          ...(cause instanceof PageRunStop && cause.code ? { errorCode: cause.code } : {}),
          verified: false, steps: [], usage: { jevCalls: 0, inputTokens: 0, outputTokens: 0 },
          elapsedMs: Date.now() - started,
        };
        return JSON.stringify(result);
      } finally {
        budget.dispose();
        browser?.close();
      }
    },
  };
}
