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
        beforeToolCall: [async ({ input, toolContext }) => ({
          input: { value: `${input.value}-before` },
          toolContext: {
            ...toolContext,
            runContext: { ...toolContext?.runContext, approved: true },
          },
        })],
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
      expect.objectContaining({ runContext: { ...runContext, approved: true } }),
    );
    expect(onResponse).toHaveBeenCalledWith([{ role: 'assistant', content: 'step response' }]);
  });

  it('lets a final beforeToolCall policy short-circuit a late-injected tool', async () => {
    const execute = vi.fn(async () => 'MUTATED');
    const deny = vi.fn(async ({ name, toolContext }) => {
      expect(name).toBe('mcp_demo_create_page');
      expect(toolContext?.runContext).toEqual({ executionMode: 'ask' });
      return {
        output: { ok: false, cancelled: true, error: 'approval required' },
      };
    });
    const context: Context = { messages: [{ role: 'user', content: 'create it' }] };

    streamTextAIMock.mockImplementation((_messages, tools, options) => {
      const output = tools.mcp_demo_create_page.execute(
        { title: 'unsafe' },
        { ...options.toolExecutionContext, toolCallId: 'mcp-call-1' },
      );
      return {
        text: output.then((value: unknown) => JSON.stringify(value)),
        steps: Promise.resolve([]),
        finishReason: Promise.resolve('stop'),
      } as any;
    });

    const result = await loop(context, {
      tools: {},
      runContext: { executionMode: 'ask' },
      hooks: {
        beforeLLMCall: [async ({ tools }) => ({
          tools: {
            ...tools,
            mcp_demo_create_page: {
              name: 'create_page',
              description: 'late plugin tool',
              inputSchema: {} as any,
              execute,
            },
          },
        })],
        beforeToolCall: [deny],
      },
    });

    expect(JSON.parse(result)).toMatchObject({ ok: false, cancelled: true });
    expect(deny).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
  });

  it('prunes incomplete tool-call parts before calling the LLM without dropping later user turns', async () => {
    const cleanedMessages = [
      { role: 'user', content: 'first' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will inspect this.' },
        ],
      } as any,
      { role: 'user', content: 'next turn' },
    ];
    const context: Context = {
      messages: [
        { role: 'user', content: 'first' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will inspect this.' },
            { type: 'tool-call', toolCallId: 'call_missing', toolName: 'read', input: { filePath: 'a.ts' } },
          ],
        } as any,
        { role: 'user', content: 'next turn' },
      ],
    };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    streamTextAIMock.mockReturnValue({
      text: Promise.resolve('recovered'),
      steps: Promise.resolve([]),
      finishReason: Promise.resolve('stop'),
    });

    try {
      const result = await loop(context);

      expect(result).toBe('recovered');
      expect(context.messages).toEqual(cleanedMessages);
      expect(streamTextAIMock).toHaveBeenCalledWith(
        cleanedMessages,
        expect.any(Object),
        expect.any(Object),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        '[loop] Pruned 1 incomplete tool-call part(s) before LLM call',
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('prunes in place so host appends from onResponse reach the next LLM call', async () => {
    const hostMessages: any[] = [
      { role: 'user', content: 'first' },
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'call_missing', toolName: 'read', input: { filePath: 'a.ts' } },
        ],
      },
      { role: 'user', content: 'search it' },
    ];
    const context: Context = { messages: hostMessages };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const seenLengths: number[] = [];
    const toolStep = [
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'call_1', toolName: 'search', input: {} }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call_1', toolName: 'search', output: { type: 'text', value: 'hit' } }] },
    ];

    streamTextAIMock.mockImplementation((messages: any[]) => {
      seenLengths.push(messages.length);
      const first = seenLengths.length === 1;
      return {
        text: Promise.resolve(first ? '' : 'done'),
        steps: Promise.resolve(first ? [{ response: { messages: toolStep } }] : []),
        finishReason: Promise.resolve(first ? 'tool-calls' : 'stop'),
      };
    });

    try {
      const result = await loop(context, {
        // Mirrors a host that captured the array reference before the run.
        onResponse: (messages) => {
          hostMessages.push(...messages);
        },
      });

      expect(result).toBe('done');
      expect(context.messages).toBe(hostMessages);
      expect(seenLengths).toEqual([2, 4]);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('removes assistant messages that only contain incomplete tool-call parts', async () => {
    const cleanedMessages = [
      { role: 'user', content: 'first' },
      { role: 'user', content: 'next turn' },
    ];
    const context: Context = {
      messages: [
        { role: 'user', content: 'first' },
        {
          role: 'assistant',
          content: [
            { type: 'tool-call', toolCallId: 'call_missing', toolName: 'read', input: { filePath: 'a.ts' } },
          ],
        } as any,
        { role: 'user', content: 'next turn' },
      ],
    };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    streamTextAIMock.mockReturnValue({
      text: Promise.resolve('recovered'),
      steps: Promise.resolve([]),
      finishReason: Promise.resolve('stop'),
    });

    try {
      const result = await loop(context);

      expect(result).toBe('recovered');
      expect(context.messages).toEqual(cleanedMessages);
      expect(streamTextAIMock).toHaveBeenCalledWith(
        cleanedMessages,
        expect.any(Object),
        expect.any(Object),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        '[loop] Pruned 1 incomplete tool-call part(s) before LLM call',
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('keeps complete tool-call history intact before calling the LLM', async () => {
    const messages = [
      { role: 'user', content: 'first' },
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'call_done', toolName: 'read', input: { filePath: 'a.ts' } },
          { type: 'tool-result', toolCallId: 'call_done', toolName: 'read', output: 'ok' },
        ],
      } as any,
      { role: 'user', content: 'next turn' },
    ];
    const context: Context = { messages };

    streamTextAIMock.mockReturnValue({
      text: Promise.resolve('ok'),
      steps: Promise.resolve([]),
      finishReason: Promise.resolve('stop'),
    });

    const result = await loop(context);

    expect(result).toBe('ok');
    expect(context.messages).toBe(messages);
    expect(streamTextAIMock).toHaveBeenCalledWith(
      messages,
      expect.any(Object),
      expect.any(Object),
    );
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

  it('reports the coming backoff wait to afterLLMCall observers', async () => {
    vi.useFakeTimers();

    const retryableError = Object.assign(new Error('overloaded'), { status: 503 });
    streamTextAIMock
      .mockImplementationOnce(() => {
        throw retryableError;
      })
      .mockImplementationOnce(() => ({
        text: Promise.resolve('ok'),
        steps: Promise.resolve([]),
        finishReason: Promise.resolve('stop'),
      }));
    const afterLLMCall = vi.fn(async () => undefined);

    const runPromise = loop({ messages: [{ role: 'user', content: 'hi' }] }, { hooks: { afterLLMCall: [afterLLMCall] } });
    await vi.advanceTimersByTimeAsync(2_000);
    await runPromise;

    expect(afterLLMCall).toHaveBeenNthCalledWith(1, expect.objectContaining({
      finishReason: 'error',
      retry: { attempt: 1, delayMs: 2_000 },
    }));
    expect(afterLLMCall).toHaveBeenNthCalledWith(2, expect.objectContaining({ finishReason: 'stop' }));
    expect((afterLLMCall.mock.calls[1] as any[])[0].retry).toBeUndefined();
  });

  it('reports no retry for errors the loop will not retry', async () => {
    streamTextAIMock.mockImplementationOnce(() => {
      throw Object.assign(new Error('bad request'), { status: 400 });
    });
    const afterLLMCall = vi.fn(async () => undefined);

    await loop({ messages: [{ role: 'user', content: 'hi' }] }, { hooks: { afterLLMCall: [afterLLMCall] } });

    expect(afterLLMCall).toHaveBeenCalledWith(expect.objectContaining({ finishReason: 'error' }));
    expect((afterLLMCall.mock.calls[0] as any[])[0].retry).toBeUndefined();
  });

  it('fires onToolError when a tool throws and still propagates the error', async () => {
    const failure = new Error('disk full');
    const failingTool: Tool = {
      name: 'save',
      description: 'save',
      inputSchema: {} as any,
      execute: async () => {
        throw failure;
      },
    };
    let toolError: unknown;
    streamTextAIMock.mockImplementation((_messages: any, tools: Record<string, Tool>, options: any) => ({
      text: tools.save.execute({ path: 'a' }, { ...options.toolExecutionContext, toolCallId: 'call-1' })
        .then(() => 'unexpected', (error: unknown) => {
          toolError = error;
          return 'handled';
        }),
      steps: Promise.resolve([]),
      finishReason: Promise.resolve('stop'),
    }));
    const onToolError = vi.fn(async () => undefined);
    const afterToolCall = vi.fn(async () => undefined);

    await loop({ messages: [{ role: 'user', content: 'save' }] }, {
      tools: { save: failingTool },
      hooks: { onToolError: [onToolError], afterToolCall: [afterToolCall] },
    });

    expect(toolError).toBe(failure);
    expect(afterToolCall).not.toHaveBeenCalled();
    expect(onToolError).toHaveBeenCalledWith(expect.objectContaining({
      name: 'save',
      input: { path: 'a' },
      error: failure,
      toolContext: expect.objectContaining({ toolCallId: 'call-1' }),
    }));
  });

  it('throws the original retryable LLM error after retries when requested', async () => {
    vi.useFakeTimers();
    try {
      const context: Context = {
        messages: [{ role: 'user', content: 'retry test' }],
      };
      const upstreamError = Object.assign(new Error('service unavailable'), { status: 503 });

      streamTextAIMock.mockImplementation(() => {
        throw upstreamError;
      });

      const runPromise = loop(context, { errorMode: 'throw' });
      const rejection = expect(runPromise).rejects.toBe(upstreamError);
      await vi.runAllTimersAsync();

      await rejection;
      expect(streamTextAIMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves a terminal stream error hidden by the no-output result wrapper', async () => {
    vi.useFakeTimers();
    try {
      const context: Context = {
        messages: [{ role: 'user', content: 'provider failure' }],
      };
      const upstreamError = Object.assign(new Error('Mock provider unavailable'), { status: 503 });
      const streamError = Object.assign(
        new Error('Failed after 3 attempts. Last error: Mock provider unavailable'),
        {
          name: 'AI_RetryError',
          errors: [upstreamError],
          lastError: upstreamError,
        },
      );
      const noOutputWrapper = Object.assign(
        new Error('No output generated. Check the stream for errors.'),
        { name: 'AI_NoOutputGeneratedError' },
      );

      streamTextAIMock.mockImplementation((_messages, _tools, options) => {
        options.onError({ error: streamError });
        return {
          text: Promise.reject(noOutputWrapper),
          steps: Promise.resolve([]),
          finishReason: Promise.resolve('error'),
        };
      });

      const runPromise = loop(context, { errorMode: 'throw' });
      const rejection = expect(runPromise).rejects.toBe(streamError);
      await vi.runAllTimersAsync();

      await rejection;
      expect(streamTextAIMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws an error finish reason to hosts that render failed turns', async () => {
    const context: Context = {
      messages: [{ role: 'user', content: 'finish reason failure' }],
    };

    streamTextAIMock.mockReturnValue({
      text: Promise.resolve('Provider ended the response with an error.'),
      steps: Promise.resolve([]),
      finishReason: Promise.resolve('error'),
    });

    await expect(loop(context, { errorMode: 'throw' })).rejects.toMatchObject({
      name: 'LLMFinishReasonError',
      message: 'Provider ended the response with an error.',
      finishReason: 'error',
    });
    expect(streamTextAIMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the legacy string result for an error finish reason by default', async () => {
    const context: Context = {
      messages: [{ role: 'user', content: 'finish reason failure' }],
    };

    streamTextAIMock.mockReturnValue({
      text: Promise.resolve('Provider ended the response with an error.'),
      steps: Promise.resolve([]),
      finishReason: Promise.resolve('error'),
    });

    await expect(loop(context)).resolves.toBe('Provider ended the response with an error.');
  });

  it('returns formatted terminal LLM errors by default', async () => {
    const context: Context = {
      messages: [{ role: 'user', content: 'auth test' }],
    };
    const upstreamError = Object.assign(new Error('invalid api key'), { status: 401 });

    streamTextAIMock.mockImplementation(() => {
      throw upstreamError;
    });

    await expect(loop(context)).resolves.toBe('Error: invalid api key');
    expect(streamTextAIMock).toHaveBeenCalledTimes(1);
  });

  it('throws the original non-retryable LLM error immediately when requested', async () => {
    const context: Context = {
      messages: [{ role: 'user', content: 'auth test' }],
    };
    const upstreamError = Object.assign(new Error('invalid api key'), { status: 401 });

    streamTextAIMock.mockImplementation(() => {
      throw upstreamError;
    });

    await expect(loop(context, { errorMode: 'throw' })).rejects.toBe(upstreamError);
    expect(streamTextAIMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the abort sentinel in throw mode', async () => {
    const context: Context = {
      messages: [{ role: 'user', content: 'abort test' }],
    };
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';

    streamTextAIMock.mockImplementation(() => {
      throw abortError;
    });

    await expect(loop(context, { errorMode: 'throw' })).resolves.toBe('Request aborted.');
    expect(streamTextAIMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the abort sentinel when the caller stops during retry backoff', async () => {
    const context: Context = {
      messages: [{ role: 'user', content: 'abort retry test' }],
    };
    const upstreamError = Object.assign(new Error('service unavailable'), { status: 503 });
    const controller = new AbortController();

    streamTextAIMock.mockImplementation(() => {
      throw upstreamError;
    });

    const runPromise = loop(context, {
      errorMode: 'throw',
      abortSignal: controller.signal,
    });
    await vi.waitFor(() => expect(streamTextAIMock).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(runPromise).resolves.toBe('Request aborted.');
    expect(streamTextAIMock).toHaveBeenCalledTimes(1);
  });

  it('stops during pre-loop compaction without applying it or calling the LLM', async () => {
    const original = [{ role: 'user', content: 'long context' }] as Context['messages'];
    const context: Context = { messages: original };
    const controller = new AbortController();
    const onCompacted = vi.fn();

    maybeCompactContextMock.mockImplementationOnce(async (_context, options) => {
      expect(options.abortSignal).toBe(controller.signal);
      controller.abort();
      return { didCompact: true, newMessages: [{ role: 'assistant', content: 'summary' }] };
    });

    const result = await loop(context, { abortSignal: controller.signal, onCompacted });

    expect(result).toBe('Request aborted.');
    expect(context.messages).toBe(original);
    expect(onCompacted).not.toHaveBeenCalled();
    expect(streamTextAIMock).not.toHaveBeenCalled();
  });

  it('invokes onCompacted plugin hooks with old/new messages', async () => {
    const context: Context = {
      messages: [{ role: 'user', content: 'long context' }],
    };
    const originalMessages = [...context.messages];

    const compacted = [{ role: 'assistant', content: '[COMPACTED_CONTEXT]\nshort summary' }];
    maybeCompactContextMock
      .mockImplementationOnce(async (_context: Context, options: any) => {
        options.onStart({ beforeMessageCount: 1, beforeEstimatedTokens: 1200 });
        await new Promise((resolve) => setTimeout(resolve, 5));
        return {
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
        };
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
        previousMessages: originalMessages,
        newMessages: compacted,
      }),
    );
    // Duration covers the summarizer call, so traces can draw it as a span.
    const { event } = (onCompactedHook.mock.calls[0] as any[])[0];
    expect(event.finishedAt - event.startedAt).toBeGreaterThanOrEqual(4);
    // The host callback did not apply the result, so the loop applied it in place.
    expect(context.messages).toEqual(compacted);
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

  it('does not diagnose an AI SDK no-output wrapper from an upstream failure as a local crash', async () => {
    vi.useFakeTimers();
    try {
      const context: Context = {
        messages: [{ role: 'user', content: 'test' }],
      };
      // AI SDK 6 creates this wrapper without retaining the HTTP status when an
      // upstream stream (for example a 503 response) closes before any output.
      const noOutputError = Object.assign(new Error('No output generated. Check the stream for errors.'), {
        name: 'AI_NoOutputGeneratedError',
      });

      streamTextAIMock.mockImplementation(() => {
        throw noOutputError;
      });

      const resultPromise = loop(context);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toContain('模型请求没有产出任何输出');
      expect(result).not.toContain('本地代码在准备 LLM 请求时崩溃');
      expect(result).not.toContain('非上游错误');
      expect(result).not.toContain('pm2');
      expect(streamTextAIMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('surfaces explicit local exceptions as local errors, not upstream', async () => {
    const context: Context = {
      messages: [{ role: 'user', content: 'test' }],
    };
    const noOutputError = Object.assign(new Error('No output generated while converting tool schema.'), {
      name: 'TypeError',
    });

    streamTextAIMock.mockImplementation(() => {
      throw noOutputError;
    });

    const result = await loop(context);

    expect(result).toContain('本地代码在准备 LLM 请求时崩溃');
    expect(result).toContain('TypeError');
    expect(result).toContain('No output generated while converting tool schema.');
    expect(result).not.toContain('上游模型没有产出任何输出');
    expect(streamTextAIMock).toHaveBeenCalledTimes(1);
  });

  it('retries no-output-generated errors that carry an upstream responseBody', async () => {
    vi.useFakeTimers();
    try {
      const context: Context = {
        messages: [{ role: 'user', content: 'test' }],
      };
      const upstreamError = Object.assign(new Error('No output generated.'), {
        responseBody: '{"error":{"message":"Upstream request failed","type":"upstream_error"}}',
      });
      streamTextAIMock
        .mockImplementationOnce(() => { throw upstreamError; })
        .mockImplementationOnce(() => { throw upstreamError; })
        .mockReturnValue({
          text: Promise.resolve('recovered'),
          steps: Promise.resolve([{ response: { messages: [] } }]),
          finishReason: Promise.resolve('stop'),
        });

      const resultPromise = loop(context);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toBe('recovered');
      expect(streamTextAIMock).toHaveBeenCalledTimes(3);
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

  describe('compaction recovery', () => {
    const compactedResult = (label: string) => ({
      didCompact: true,
      reason: 'force-summary',
      newMessages: [
        { role: 'assistant', content: `[COMPACTED_CONTEXT]\n${label}` },
        { role: 'user', content: 'continue' },
      ],
      stats: {
        forced: true,
        beforeMessageCount: 2,
        afterMessageCount: 2,
        beforeEstimatedTokens: 1000,
        afterEstimatedTokens: 100,
        strategy: 'summary',
      },
    });
    const stopResult = (text: string) => ({
      text: Promise.resolve(text),
      steps: Promise.resolve([]),
      finishReason: Promise.resolve('stop'),
    });

    it('compacts and retries when the provider rejects the prompt as too long', async () => {
      const context: Context = { messages: [{ role: 'user', content: 'huge history' }] };
      const overflow = Object.assign(new Error('prompt is too long: 230000 tokens > 200000 maximum'), { statusCode: 400 });
      maybeCompactContextMock
        .mockResolvedValueOnce({ didCompact: false })
        .mockResolvedValueOnce(compactedResult('after overflow'))
        .mockResolvedValue({ didCompact: false });
      streamTextAIMock
        .mockImplementationOnce(() => { throw overflow; })
        .mockImplementationOnce(() => stopResult('recovered'));

      await expect(loop(context, { errorMode: 'throw' })).resolves.toBe('recovered');
      expect(maybeCompactContextMock).toHaveBeenCalledWith(context, expect.objectContaining({ force: true }));
      expect(context.messages[0].content).toContain('after overflow');
    });

    it('does not treat unrelated 400 errors as overflow', async () => {
      const context: Context = { messages: [{ role: 'user', content: 'bad request' }] };
      const invalid = Object.assign(new Error('invalid tool schema'), { statusCode: 400 });
      streamTextAIMock.mockImplementation(() => { throw invalid; });

      await expect(loop(context, { errorMode: 'throw' })).rejects.toBe(invalid);
      expect(maybeCompactContextMock).not.toHaveBeenCalledWith(context, expect.objectContaining({ force: true }));
    });

    it('can compact again later in the same run once a request has gone through', async () => {
      const context: Context = { messages: [{ role: 'user', content: 'long agent task' }] };
      // Default cap is 2 consecutive compactions; three across the run must still be allowed.
      maybeCompactContextMock
        .mockResolvedValueOnce(compactedResult('first'))
        .mockResolvedValueOnce(compactedResult('second'))
        .mockResolvedValueOnce(compactedResult('third'))
        .mockResolvedValue({ didCompact: false });
      // Each step adds a large tool exchange, so history grows past the
      // post-compaction floor before the next pre-loop check.
      const toolStep = () => ({
        text: Promise.resolve(''),
        steps: Promise.resolve([{ response: { messages: [{ role: 'assistant', content: 'x'.repeat(4000) }] } }]),
        finishReason: Promise.resolve('tool-calls'),
      });
      streamTextAIMock
        .mockImplementationOnce(toolStep)
        .mockImplementationOnce(toolStep)
        .mockImplementationOnce(() => stopResult('finished'));
      const onCompacted = vi.fn();
      const onResponse = (messages: any[]) => { context.messages.push(...messages); };

      await expect(loop(context, { onCompacted, onResponse })).resolves.toBe('finished');
      expect(onCompacted).toHaveBeenCalledTimes(3);
      expect(onCompacted.mock.calls.map(([, event]) => event.attempt)).toEqual([1, 2, 3]);
    });

    it('does not re-run pre-loop compaction until history grows after the last one', async () => {
      const context: Context = { messages: [{ role: 'user', content: 'task' }] };
      maybeCompactContextMock
        .mockResolvedValueOnce(compactedResult('first'))
        .mockResolvedValue(compactedResult('again'));
      const toolStep = () => ({
        text: Promise.resolve(''),
        steps: Promise.resolve([{ response: { messages: [] } }]),
        finishReason: Promise.resolve('tool-calls'),
      });
      streamTextAIMock
        .mockImplementationOnce(toolStep)
        .mockImplementationOnce(toolStep)
        .mockImplementationOnce(() => stopResult('finished'));

      await expect(loop(context)).resolves.toBe('finished');
      // One compaction; later steps added nothing, so no summarizer calls were spent.
      expect(maybeCompactContextMock).toHaveBeenCalledTimes(1);
    });

    it('treats throughput limits as rate limits, not prompt overflow', async () => {
      const context: Context = { messages: [{ role: 'user', content: 'busy' }] };
      const tpm = Object.assign(new Error('Request too large for gpt-4o on tokens per min (TPM): Limit 30000'), { statusCode: 429 });
      const wrapped = Object.assign(new Error('Failed after 3 attempts. Last error: Request too large'), {
        name: 'AI_RetryError',
        lastError: tpm,
      });
      streamTextAIMock.mockImplementation(() => { throw wrapped; });

      await expect(loop(context, { errorMode: 'throw' })).rejects.toBe(wrapped);
      expect(maybeCompactContextMock).not.toHaveBeenCalledWith(context, expect.objectContaining({ force: true }));
    });

    it('stops resuming after repeated output-cap hits instead of looping forever', async () => {
      const context: Context = { messages: [{ role: 'user', content: 'think hard' }] };
      streamTextAIMock.mockImplementation(() => ({
        text: Promise.resolve(''),
        steps: Promise.resolve([{ response: { messages: [] } }]),
        finishReason: Promise.resolve('length'),
        usage: Promise.resolve({ inputTokens: 1000, outputTokens: 32000 }),
      }));

      await expect(loop(context)).resolves.toMatch(/Output limit reached/);
      expect(streamTextAIMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('duplicate read notes', () => {
    const readTool: Tool = {
      name: 'read',
      description: 'read',
      inputSchema: {} as any,
      execute: async () => ({ content: 'file body' }),
    };
    const editTool: Tool = {
      name: 'edit',
      description: 'edit',
      inputSchema: {} as any,
      execute: async () => ({ success: true }),
    };

    it('flags only a repeated range, and forgets a path after it is edited', async () => {
      const outputs: any[] = [];
      streamTextAIMock.mockImplementation((_messages: any, tools: Record<string, Tool>) => {
        const text = (async () => {
          const call = (name: string, input: unknown) => tools[name].execute(input, {});
          outputs.push(await call('read', { filePath: '/a.ts', offset: 0, limit: 100 }));
          outputs.push(await call('read', { filePath: '/a.ts', offset: 100, limit: 100 }));
          outputs.push(await call('read', { filePath: '/a.ts', offset: 0, limit: 100 }));
          await call('edit', { filePath: '/a.ts', oldString: 'x', newString: 'y' });
          outputs.push(await call('read', { filePath: '/a.ts', offset: 0, limit: 100 }));
          return 'done';
        })();
        return { text, steps: Promise.resolve([]), finishReason: Promise.resolve('stop') };
      });

      await loop({ messages: [{ role: 'user', content: 'page through' }] }, { tools: { read: readTool, edit: editTool } });

      expect(outputs.map((output) => Boolean(output._note))).toEqual([false, false, true, false]);
    });
  });
});
