import type { ModelMessage } from "ai";
import { summarizeMessages } from "../ai";
import {
  COMPACT_SUMMARY_MAX_TOKENS,
  COMPACT_TRIGGER,
  COMPACT_TARGET,
  CONTEXT_WINDOW_TOKENS,
  KEEP_LAST_TURNS,
} from "../config/index";
import type { Context, LLMProviderFactory, ModelType } from "../shared/types";
import { estimateMessageTokens, estimateTokens } from "./estimate.js";
import { fitTranscript, renderTranscript } from "./transcript.js";

export { estimateTokens } from "./estimate.js";

export type CompactStats = {
  forced: boolean;
  beforeMessageCount: number;
  afterMessageCount: number;
  beforeEstimatedTokens: number;
  afterEstimatedTokens: number;
  /**
   * `summary`: summary plus a recent tail within target.
   * `summary-too-large`: the smallest valid tail still exceeds target; the
   * summary is kept and the result is smaller than before.
   * `fallback`: the summarizer failed; a clipped transcript replaces it.
   */
  strategy: 'summary' | 'summary-too-large' | 'fallback';
};

export type CompactResult = {
  didCompact: boolean;
  reason?: string;
  newMessages?: ModelMessage[];
  stats?: CompactStats;
};

const SUMMARY_PREFIX = '[COMPACTED_CONTEXT]';
/** Share of the target left for the verbatim tail; the rest is summary headroom. */
const RECENT_SHARE = 0.6;
const FORCED_RECENT_SHARE = 0.4;
/** Summarizer input budget as a share of the context window. */
const SUMMARY_INPUT_SHARE = 0.5;
/** Clipped-transcript budget used when the summarizer fails. */
const FALLBACK_SHARE = 0.2;

/**
 * Summary output cap: 3% of the window, between 4K and 8K tokens. A fixed
 * 1200 left reasoning models too little room after thinking, so summaries
 * came back cut short and each compaction lost more earlier history.
 */
export const summaryOutputTokens = (windowTokens: number): number => (
  Math.min(8000, Math.max(4000, Math.round(windowTokens * 0.03)))
);

const ensureSummaryPrefix = (summary: string): string => {
  const trimmed = summary.trim();
  if (trimmed.length === 0) {
    return '';
  }
  if (trimmed.startsWith(SUMMARY_PREFIX)) {
    return trimmed;
  }
  return `${SUMMARY_PREFIX}\n${trimmed}`;
};

/**
 * Ensure compacted messages end with a user-role message.
 * Some providers (e.g. claude-opus-4.7 via copilot-api) reject requests
 * where the last message has role "assistant" (no prefill support).
 *
 * Strategy:
 *   1. Strip trailing assistant messages.
 *   2. If everything is stripped (all-assistant input, e.g. summary-only
 *      compact result), append a placeholder user message so the
 *      conversation still ends with a user turn — never returns the
 *      original all-assistant array, which would re-trigger the same 400.
 */
const PLACEHOLDER_USER_MESSAGE: ModelMessage = {
  role: 'user',
  content: 'Please continue based on the context above.',
};

const ensureEndsWithUser = (messages: ModelMessage[]): ModelMessage[] => {
  let end = messages.length;
  while (end > 0 && messages[end - 1].role === 'assistant') {
    end--;
  }
  if (end === 0) {
    return [...messages, PLACEHOLDER_USER_MESSAGE];
  }
  return end === messages.length ? messages : messages.slice(0, end);
};

const contentParts = (message: ModelMessage): any[] => {
  const content = (message as { content?: unknown }).content;
  return Array.isArray(content) ? content : [];
};

/**
 * Indices where history may be cut: the kept tail never starts with a tool
 * result, and no tool call in the summarized head has its result in the tail.
 * Calls that never receive a result anywhere (an aborted step) do not block
 * cutting; the loop prunes them before the next request.
 */
function findCutBoundaries(messages: ModelMessage[]): number[] {
  const answered = new Set<string>();
  for (const message of messages) {
    for (const part of contentParts(message)) {
      if (part?.type === 'tool-result' && typeof part.toolCallId === 'string') answered.add(part.toolCallId);
    }
  }

  const open = new Set<string>();
  const boundaries: number[] = [];
  messages.forEach((message, index) => {
    if (index > 0 && open.size === 0 && message.role !== 'tool') boundaries.push(index);
    for (const part of contentParts(message)) {
      if (part?.type === 'tool-call' && answered.has(part.toolCallId)) open.add(part.toolCallId);
      if (part?.type === 'tool-result') open.delete(part.toolCallId);
    }
  });
  return boundaries;
}

/** Suffix sums so tail sizes are O(1) per candidate cut. */
function tailTokens(messages: ModelMessage[]): number[] {
  const sums = new Array<number>(messages.length + 1).fill(0);
  for (let index = messages.length - 1; index >= 0; index--) {
    sums[index] = sums[index + 1] + estimateMessageTokens(messages[index]);
  }
  return sums;
}

/**
 * Pick the cut. Prefer keeping the last `keepTurns` user turns when they fit
 * the tail budget (multi-turn chats behave as before; a forced compaction
 * keeps only the current turn). Otherwise keep the largest tail that fits,
 * which also lets a single long agent turn compact its own earlier tool
 * exchanges. Without a fitting tail, keep the smallest valid one.
 */
function chooseCut(
  messages: ModelMessage[],
  boundaries: number[],
  recentBudget: number,
  keepTurns: number,
): number | undefined {
  if (boundaries.length === 0) return undefined;
  const sums = tailTokens(messages);
  const userIndices = messages.flatMap((message, index) => (message.role === 'user' ? [index] : []));
  if (userIndices.length > keepTurns) {
    const turnCut = userIndices[userIndices.length - keepTurns];
    if (boundaries.includes(turnCut) && sums[turnCut] <= recentBudget) return turnCut;
  }
  const fitting = boundaries.find((index) => sums[index] <= recentBudget);
  return fitting ?? boundaries[boundaries.length - 1];
}

/**
 * Split at the cut. The newest user message states the current task; when it
 * would fall into the summarized head, it stays verbatim at the front of the
 * tail unless it alone is too large to pin.
 */
function splitAtCut(messages: ModelMessage[], cut: number, recentBudget: number) {
  let pinnedIndex = -1;
  for (let index = cut - 1; index >= 0; index--) {
    if (messages[index].role === 'user') {
      pinnedIndex = index;
      break;
    }
  }
  const lastUserAfterCut = messages.slice(cut).some((message) => message.role === 'user');
  const pin = pinnedIndex >= 0 && !lastUserAfterCut
    && estimateMessageTokens(messages[pinnedIndex]) <= recentBudget / 2;

  const oldMessages = pin
    ? messages.slice(0, cut).filter((_message, index) => index !== pinnedIndex)
    : messages.slice(0, cut);
  const recentMessages = pin ? [messages[pinnedIndex], ...messages.slice(cut)] : messages.slice(cut);
  return { oldMessages, recentMessages };
}

export const maybeCompactContext = async (
  context: Context,
  options?: {
    force?: boolean;
    provider?: LLMProviderFactory;
    model?: string;
    modelType?: ModelType;
    /**
     * Per-run context window override (e.g. per-model). When set, the trigger
     * (75%) and target (50%) are derived from it, taking precedence over the
     * env-level CONTEXT_WINDOW_TOKENS / COMPACT_* values.
     */
    contextWindowTokens?: number;
    /**
     * Provider-reported prompt size for the current history (last request's
     * input tokens plus an estimate of messages added since). Used when it is
     * larger than the local estimate, which cannot see system prompt or tool
     * schema cost.
     */
    observedTokens?: number;
    /** Fired once compaction is actually going to run (summarization LLM call imminent) — lets hosts show progress. */
    onStart?: (info: { beforeMessageCount: number; beforeEstimatedTokens: number }) => void;
    /** Cancels the summarization call. An aborted compaction never rewrites history. */
    abortSignal?: AbortSignal;
  }
): Promise<CompactResult> => {
  const { messages } = context;
  if (messages.length === 0 || options?.abortSignal?.aborted) {
    return { didCompact: false };
  }

  const windowOverride = options?.contextWindowTokens && options.contextWindowTokens > 0
    ? options.contextWindowTokens
    : undefined;
  const compactTrigger = windowOverride ? Math.floor(windowOverride * 0.75) : COMPACT_TRIGGER;
  const compactTarget = windowOverride ? Math.floor(windowOverride * 0.5) : COMPACT_TARGET;
  const windowTokens = windowOverride ?? CONTEXT_WINDOW_TOKENS;

  const force = Boolean(options?.force);
  const beforeMessageCount = messages.length;
  const beforeEstimatedTokens = Math.max(estimateTokens(messages), options?.observedTokens ?? 0);
  if (!force && beforeEstimatedTokens < compactTrigger) {
    return { didCompact: false };
  }

  const recentBudget = Math.floor(compactTarget * (force ? FORCED_RECENT_SHARE : RECENT_SHARE));
  const cut = chooseCut(messages, findCutBoundaries(messages), recentBudget, force ? 1 : KEEP_LAST_TURNS);
  if (cut === undefined) {
    return { didCompact: false, reason: 'no-safe-boundary' };
  }
  const { oldMessages, recentMessages } = splitAtCut(messages, cut, recentBudget);
  if (oldMessages.length === 0) {
    return { didCompact: false };
  }

  options?.onStart?.({ beforeMessageCount, beforeEstimatedTokens });

  const transcript = renderTranscript(oldMessages);
  let summaryText: string;
  let strategy: CompactStats['strategy'] = 'summary';
  try {
    const summary = await summarizeMessages(
      [{ role: 'user', content: `Conversation transcript:\n${fitTranscript(transcript, Math.floor(windowTokens * SUMMARY_INPUT_SHARE))}` }],
      {
        provider: options?.provider,
        model: options?.model,
        modelType: options?.modelType,
        maxOutputTokens: COMPACT_SUMMARY_MAX_TOKENS ?? summaryOutputTokens(windowTokens),
        abortSignal: options?.abortSignal,
      },
    );
    // Providers may resolve after a stop; the result must still be discarded.
    if (options?.abortSignal?.aborted) {
      return { didCompact: false, reason: 'aborted' };
    }
    summaryText = ensureSummaryPrefix(summary);
    if (!summaryText) {
      throw new Error('Empty summary result');
    }
  } catch {
    // A user stop is not a summarizer failure: keep history intact.
    if (options?.abortSignal?.aborted) {
      return { didCompact: false, reason: 'aborted' };
    }
    strategy = 'fallback';
    summaryText = `${SUMMARY_PREFIX}\n(Summary unavailable; clipped transcript of earlier history.)\n${fitTranscript(transcript, Math.floor(compactTarget * FALLBACK_SHARE))}`;
  }

  const newMessages = ensureEndsWithUser([
    { role: 'assistant', content: summaryText },
    ...recentMessages,
  ]);
  const afterEstimatedTokens = estimateTokens(newMessages);
  if (afterEstimatedTokens >= estimateTokens(messages)) {
    return { didCompact: false, reason: 'no-gain' };
  }
  if (strategy === 'summary' && afterEstimatedTokens > compactTarget) {
    strategy = 'summary-too-large';
  }

  return {
    didCompact: true,
    reason: strategy === 'fallback' ? 'fallback' : force ? 'force-summary' : 'summary',
    newMessages,
    stats: {
      forced: force,
      beforeMessageCount,
      afterMessageCount: newMessages.length,
      beforeEstimatedTokens,
      afterEstimatedTokens,
      strategy,
    },
  };
};
