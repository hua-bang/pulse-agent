import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelMessage } from 'ai';
import type { Context } from '../shared/types';

const { summarizeMessagesMock } = vi.hoisted(() => ({
  summarizeMessagesMock: vi.fn(),
}));

vi.mock('../ai', () => ({
  summarizeMessages: summarizeMessagesMock,
}));

import { maybeCompactContext } from './index';
import { estimateTextTokens, estimateTokens } from './estimate';
import { COMPACT_TARGET, CONTEXT_WINDOW_TOKENS } from '../config/index';

/** One user message followed by many tool exchanges: a sub-agent or headless run. */
function singleTurnRun(steps: number, outputChars = 4000): Context {
  const messages: ModelMessage[] = [{ role: 'user', content: 'Refactor the parser and keep tests green.' }];
  for (let index = 0; index < steps; index++) {
    messages.push({
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: `call-${index}`, toolName: 'read', input: { index } }],
    });
    messages.push({
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: `call-${index}`,
        toolName: 'read',
        output: { type: 'text', value: 'x'.repeat(outputChars) },
      }],
    });
  }
  return { messages };
}

function orphanToolResults(messages: ModelMessage[]): string[] {
  const calls = new Set<string>();
  const orphans: string[] = [];
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content as any[]) {
      if (part.type === 'tool-call') calls.add(part.toolCallId);
      if (part.type === 'tool-result' && !calls.has(part.toolCallId)) orphans.push(part.toolCallId);
    }
  }
  return orphans;
}

describe('maybeCompactContext boundaries', () => {
  beforeEach(() => {
    summarizeMessagesMock.mockReset();
    summarizeMessagesMock.mockResolvedValue('summary of earlier work');
  });

  it('compacts a long single-user-turn run without force', async () => {
    const context = singleTurnRun(100);

    const result = await maybeCompactContext(context);

    expect(result.didCompact).toBe(true);
    expect(result.stats!.afterEstimatedTokens).toBeLessThan(result.stats!.beforeEstimatedTokens);
    expect(result.stats!.afterEstimatedTokens).toBeLessThanOrEqual(COMPACT_TARGET);
  });

  it('never leaves a tool result without its call, even when forced on one turn', async () => {
    for (const force of [false, true]) {
      const result = await maybeCompactContext(singleTurnRun(100), { force });

      expect(result.didCompact).toBe(true);
      expect(orphanToolResults(result.newMessages!)).toEqual([]);
      expect(result.newMessages![1].role).not.toBe('tool');
    }
  });

  it('keeps the current task verbatim after the summary', async () => {
    const result = await maybeCompactContext(singleTurnRun(100));

    expect(result.newMessages![0]).toMatchObject({ role: 'assistant' });
    expect(String(result.newMessages![0].content)).toMatch(/^\[COMPACTED_CONTEXT\]/);
    expect(result.newMessages![1]).toEqual({ role: 'user', content: 'Refactor the parser and keep tests green.' });
  });

  it('keeps the last four user turns of a multi-turn chat when they fit', async () => {
    const messages: ModelMessage[] = [];
    // 14 turns of ~3.75k tokens: above the 48k trigger, and the last four fit the tail budget.
    for (let turn = 0; turn < 14; turn++) {
      messages.push({ role: 'user', content: `question ${turn} ${'q'.repeat(15000)}` });
      messages.push({ role: 'assistant', content: `answer ${turn}` });
    }

    const result = await maybeCompactContext({ messages });

    expect(result.didCompact).toBe(true);
    const keptQuestions = result.newMessages!
      .filter((message) => message.role === 'user')
      .map((message) => String(message.content).split(' ').slice(0, 2).join(' '));
    expect(keptQuestions).toEqual(['question 10', 'question 11', 'question 12', 'question 13']);
  });

  it('sends the summarizer a bounded plain-text transcript', async () => {
    await maybeCompactContext(singleTurnRun(400));

    const [summaryInput] = summarizeMessagesMock.mock.calls[0];
    expect(summaryInput).toHaveLength(1);
    expect(summaryInput[0].role).toBe('user');
    expect(typeof summaryInput[0].content).toBe('string');
    expect(estimateTextTokens(summaryInput[0].content)).toBeLessThanOrEqual(CONTEXT_WINDOW_TOKENS * 0.5 + 100);
  });

  it('falls back to a clipped transcript when the summarizer fails', async () => {
    summarizeMessagesMock.mockRejectedValue(new Error('provider down'));
    const context = singleTurnRun(100);

    const result = await maybeCompactContext(context);

    expect(result.didCompact).toBe(true);
    expect(result.stats!.strategy).toBe('fallback');
    expect(String(result.newMessages![0].content)).toContain('[assistant → read]');
    expect(orphanToolResults(result.newMessages!)).toEqual([]);
    expect(result.stats!.afterEstimatedTokens).toBeLessThan(result.stats!.beforeEstimatedTokens);
  });

  it.each([false, true])('bounds mixed-density transcripts through compaction (fallback: %s)', async (fallback) => {
    if (fallback) summarizeMessagesMock.mockRejectedValue(new Error('provider down'));
    const chunks = [
      ...Array.from({ length: 25 }, () => '中'.repeat(1000)),
      ...Array.from({ length: 900 }, () => 'a'.repeat(1000)),
      ...Array.from({ length: 75 }, () => '文'.repeat(1000)),
    ];
    const context: Context = {
      messages: chunks.map((content, index) => ({
        role: index % 2 === 0 ? 'user' : 'assistant',
        content,
      })),
    };

    const result = await maybeCompactContext(context);

    expect(result.didCompact).toBe(true);
    const [summaryInput] = summarizeMessagesMock.mock.calls[0];
    const transcript = summaryInput[0].content.slice('Conversation transcript:\n'.length);
    expect(estimateTextTokens(transcript)).toBeLessThanOrEqual(Math.floor(CONTEXT_WINDOW_TOKENS * 0.5));
    if (fallback) {
      expect(result.stats!.strategy).toBe('fallback');
      const summary = String(result.newMessages![0].content);
      const clipped = summary.slice(summary.indexOf('\n', summary.indexOf('\n') + 1) + 1);
      expect(estimateTextTokens(clipped)).toBeLessThanOrEqual(Math.floor(COMPACT_TARGET * 0.2));
    }
  });

  it('does nothing below the trigger', async () => {
    const result = await maybeCompactContext(singleTurnRun(3));

    expect(result.didCompact).toBe(false);
    expect(summarizeMessagesMock).not.toHaveBeenCalled();
  });
});

describe('token estimate', () => {
  it('counts CJK text close to one token per character', () => {
    expect(estimateTextTokens('中文内容'.repeat(250))).toBe(1000);
    expect(estimateTextTokens('abcd'.repeat(250))).toBe(250);
  });

  it('charges a flat cost for media instead of the base64 length', () => {
    const tokens = estimateTokens([{
      role: 'user',
      content: [{ type: 'image', image: 'A'.repeat(2_000_000), mediaType: 'image/png' }],
    }]);
    expect(tokens).toBeLessThan(2000);
  });
});
