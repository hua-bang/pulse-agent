import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Context, Tool } from '../shared/types.js';

const { streamTextAIMock, maybeCompactContextMock } = vi.hoisted(() => ({
  streamTextAIMock: vi.fn(),
  maybeCompactContextMock: vi.fn(),
}));

vi.mock('../ai', () => ({
  streamTextAI: streamTextAIMock,
}));

vi.mock('../context', () => ({
  maybeCompactContext: maybeCompactContextMock,
}));

import { loop } from './loop.js';

describe('loop', () => {
  beforeEach(() => {
    streamTextAIMock.mockReset();
    maybeCompactContextMock.mockReset();
    maybeCompactContextMock.mockResolvedValue({ didCompact: false });
    vi.useRealTimers();
  });

  it('applies llm/tool hooks and returns transformed tool output', async () => {
    const context: Context = {
      messages: [{ role: 'user', content: 'run tool' }],
    };

    const echoExecute = vi.fn(async (input: { value: string }) => `${input.value}-exec`);
    const echoTool: Tool = {
      name: 'echo',
      description: 'echo',
      inputSchema: {} as any,
      execute: echoExecute,
    };

    const beforeLLMCall = vi.fn(async ({ systemPrompt, tools }: any) => ({
      systemPrompt: `${String(systemPrompt)}-hooked`,
      tools,
    }));

    const onResponse = vi.fn();

    streamTextAIMock.mockImplementation((_messages: any, tools: Record<string, Tool>, options: any) => {
      const text = (async () => {
        const output = await tools.echo.execute({ value: 'seed' }, options.toolExecutionContext);
        return `tool:${output}`;
      })();

      return {
        text,
        steps: Promise.resolve([
          {
            response: {
              messages: [{ role: 'assistant', content: 'step response' }],
            },
          },
        ]),
        finishReason: Promise.resolve('stop'),
      };
    });

    const runContext = {
      sessionId: 'session-123',
      userText: 'run tool',
    };

    const result = await loop(context, {
      tools: {
        echo: echoTool,
      },
      systemPrompt: 'base-prompt',
      runContext,
      hooks: {
        beforeLLMCall: [beforeLLMCall],
        beforeToolCall: [async ({ input }) => ({ input: { value: `${input.value}-before` } })],
        afterToolCall: [async ({ output }) => ({ output: `${output}-after` })],
      },
      onResponse,
    });

    expect(result).toBe('tool:seed-before-exec-after');
    expect(beforeLLMCall).toHaveBeenCalledTimes(1);
    expect(streamTextAIMock).toHaveBeenCalledWith(
      context.messages,
      expect.objectContaining({ echo: expect.any(Object) }),
      expect.objectContaining({ systemPrompt: 'base-prompt-hooked' }),
    );
    expect(echoExecute).toHaveBeenCalledWith(
      expect.objectContaining({ value: 'seed-before' }),
      expect.objectContaining({ runContext }),
    );
    expect(onResponse).toHaveBeenCalledWith([{ role: 'assistant', content: 'step response' }]);
  });

  it('retries retryable errors with backoff and eventually succeeds', async () => {
    vi.useFakeTimers();

    const context: Context = {
      messages: [{ role: 'user', content: 'retry test' }],
    };

    const retryableError = Object.assign(new Error('rate limited'), { status: 429 });

    streamTextAIMock
      .mockImplementationOnce(() => {
        throw retryableError;
      })
      .mockImplementationOnce(() => ({
        text: Promise.resolve('retry-success'),
        steps: Promise.resolve([]),
        finishReason: Promise.resolve('stop'),
      }));

    const runPromise = loop(context);

    await vi.advanceTimersByTimeAsync(2_000);

    await expect(runPromise).resolves.toBe('retry-success');
    expect(streamTextAIMock).toHaveBeenCalledTimes(2);
  });

  it('invokes onCompacted plugin hooks with old/new messages', async () => {
    const context: Context = {
      messages: [{ role: 'user', content: 'long context' }],
    };

    const compacted = [{ role: 'assistant', content: '[COMPACTED_CONTEXT]\nshort summary' }];
    maybeCompactContextMock
      .mockResolvedValueOnce({
        didCompact: true,
        reason: 'summary',
        newMessages: compacted,
        stats: {
          forced: false,
          beforeMessageCount: 1,
          afterMessageCount: 1,
          beforeEstimatedTokens: 1200,
          afterEstimatedTokens: 300,
          strategy: 'summary',
        },
      })
      .mockResolvedValueOnce({ didCompact: false });

    streamTextAIMock.mockReturnValue({
      text: Promise.resolve('done'),
      steps: Promise.resolve([]),
      finishReason: Promise.resolve('stop'),
    });

    const onCompactedHook = vi.fn(async () => undefined);
    const onCompacted = vi.fn();

    const result = await loop(context, {
      onCompacted,
      hooks: {
        onCompacted: [onCompactedHook],
      },
    });

    expect(result).toBe('done');
    expect(onCompacted).toHaveBeenCalledTimes(1);
    expect(onCompacted).toHaveBeenCalledWith(
      compacted,
      expect.objectContaining({
        trigger: 'pre-loop',
        attempt: 1,
        beforeEstimatedTokens: 1200,
        afterEstimatedTokens: 300,
      }),
    );
    expect(onCompactedHook).toHaveBeenCalledTimes(1);
    expect(onCompactedHook).toHaveBeenCalledWith(
      expect.objectContaining({
        context,
        previousMessages: context.messages,
        newMessages: compacted,
      }),
    );
  });

  it('stops when tool-call steps reach max step limit', async () => {
    const context: Context = {
      messages: [{ role: 'user', content: 'step limit' }],
    };

    streamTextAIMock.mockReturnValue({
      text: Promise.resolve(''),
      steps: Promise.resolve(Array.from({ length: 100 }, () => ({ response: { messages: [] } }))),
      finishReason: Promise.resolve('tool-calls'),
    });

    const result = await loop(context);

    expect(result).toBe('Max steps reached, task may be incomplete.');
  });

  it('records llm errors and formats request-body upstream failures', async () => {
    const context: Context = {
      messages: [{ role: 'user', content: 'large request' }],
    };
    const afterLLMCall = vi.fn(async () => undefined);
    const upstreamError = Object.assign(
      new Error('API Error: 400 {"error":{"message":"Failed to read request body","type":"invalid_request_error"}}'),
      {
        status: 400,
        responseBody: '{"error":{"message":"Failed to read request body","type":"invalid_request_error"}}',
      },
    );

    streamTextAIMock.mockImplementation(() => {
      throw upstreamError;
    });

    const result = await loop(context, {
      hooks: {
        afterLLMCall: [afterLLMCall],
      },
    });

    expect(result).toContain('上游模型服务读取请求体失败或超时');
    expect(afterLLMCall).toHaveBeenCalledWith(
      expect.objectContaining({
        context,
        finishReason: 'error',
        text: '',
        error: upstreamError,
      }),
    );
  });

  it('retries no-output-generated errors before giving up', async () => {
    vi.useFakeTimers();
    try {
      const context: Context = {
        messages: [{ role: 'user', content: 'test' }],
      };
      const noOutputError = Object.assign(new Error('No output generated.'), {
        responseBody: '{"error":{"message":"Upstream request failed","type":"upstream_error"}}',
      });
      // Fail twice, then succeed on the third attempt
      streamTextAIMock
        .mockImplementationOnce(() => { throw noOutputError; })
        .mockImplementationOnce(() => { throw noOutputError; })
        .mockReturnValue({
          text: Promise.resolve('all good'),
          steps: Promise.resolve([{ response: { messages: [] } }]),
          finishReason: Promise.resolve('stop'),
        });

      const resultPromise = loop(context);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toBe('all good');
      expect(streamTextAIMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('extracts error detail from mixed JSON+SSE responseBody on no-output errors', async () => {
    vi.useFakeTimers();
    try {
      const context: Context = {
        messages: [{ role: 'user', content: 'test' }],
      };
      const sseResponseBody =
        '{"error":{"message":"Upstream request failed","type":"upstream_error"}}' +
        'event: response.failed\n' +
        'data: {"type":"response.failed","response":{"id":"resp_abc","object":"response","model":"gpt-5.4","status":"failed","output":[],"error":{"code":"upstream_error","message":"Upstream request failed"}}}\n';

      const upstreamError = Object.assign(new Error('No output generated.'), {
        responseBody: sseResponseBody,
      });

      streamTextAIMock.mockImplementation(() => {
        throw upstreamError;
      });

      const resultPromise = loop(context);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toContain('上游模型没有产出任何输出');
      expect(result).toContain('Upstream request failed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('times out LLM calls that never produce a first chunk', async () => {
    vi.useFakeTimers();

    const context: Context = {
      messages: [{ role: 'user', content: 'hung llm' }],
    };
    const afterLLMCall = vi.fn(async () => undefined);
    let llmAbortSignal: AbortSignal | undefined;

    streamTextAIMock.mockImplementation((_messages: any, _tools: Record<string, Tool>, options: any) => {
      llmAbortSignal = options.abortSignal;
      return {
        text: new Promise(() => undefined),
        steps: new Promise(() => undefined),
        finishReason: new Promise(() => undefined),
      };
    });

    const runPromise = loop(context, {
      hooks: {
        afterLLMCall: [afterLLMCall],
      },
    });

    await vi.advanceTimersByTimeAsync(180_000);

    await expect(runPromise).resolves.toContain('上游模型请求超时');
    expect(llmAbortSignal?.aborted).toBe(true);
    expect(afterLLMCall).toHaveBeenCalledWith(
      expect.objectContaining({
        context,
        finishReason: 'error',
        text: '',
        error: expect.objectContaining({
          name: 'LLMTimeoutError',
          code: 'LLM_TIMEOUT',
          timeoutReason: 'first-chunk',
          timeoutMs: 180_000,
        }),
      }),
    );
  });

  it('reports active tool execution when a total timeout fires during tool execution', async () => {
    vi.useFakeTimers();

    const context: Context = {
      messages: [{ role: 'user', content: 'run hung tool' }],
    };
    const hungTool: Tool = {
      name: 'hung',
      description: 'hung',
      inputSchema: {} as any,
      execute: vi.fn(() => new Promise(() => undefined)),
    };
    const afterLLMCall = vi.fn(async () => undefined);

    streamTextAIMock.mockImplementation((_messages: any, tools: Record<string, Tool>, options: any) => {
      options.onChunk?.({ chunk: { type: 'text-delta', text: 'starting' } });
      const text = tools.hung.execute({ command: 'git rebase --continue' }, options.toolExecutionContext);
      return {
        text,
        steps: new Promise(() => undefined),
        finishReason: new Promise(() => undefined),
      };
    });

    const runPromise = loop(context, {
      tools: {
        hung: hungTool,
      },
      hooks: {
        afterLLMCall: [afterLLMCall],
      },
    });

    await vi.advanceTimersByTimeAsync(600_000);

    const result = await runPromise;

    expect(result).toContain('工具执行超时');
    expect(result).toContain('`hung`');
    expect(result).toContain('git rebase --continue');
    expect(afterLLMCall).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          activeTool: expect.objectContaining({
            name: 'hung',
            inputPreview: expect.stringContaining('git rebase --continue'),
          }),
        }),
      }),
    );
  });

  it('returns promptly when the caller aborts a pending LLM call', async () => {
    vi.useFakeTimers();

    const context: Context = {
      messages: [{ role: 'user', content: 'abort llm' }],
    };
    const ac = new AbortController();
    let llmAbortSignal: AbortSignal | undefined;

    streamTextAIMock.mockImplementation((_messages: any, _tools: Record<string, Tool>, options: any) => {
      llmAbortSignal = options.abortSignal;
      return {
        text: new Promise(() => undefined),
        steps: new Promise(() => undefined),
        finishReason: new Promise(() => undefined),
      };
    });

    const runPromise = loop(context, {
      abortSignal: ac.signal,
    });

    await vi.waitFor(() => {
      expect(streamTextAIMock).toHaveBeenCalledTimes(1);
    });

    ac.abort();

    await expect(runPromise).resolves.toBe('Request aborted.');
    expect(llmAbortSignal?.aborted).toBe(true);
  });
});
