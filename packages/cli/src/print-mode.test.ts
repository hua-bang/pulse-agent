import { afterEach, describe, expect, it, vi } from 'vitest';

const agentMock = vi.hoisted(() => ({
  run: undefined as undefined | ((context: any, options: any) => Promise<string>),
}));

vi.mock('pulse-coder-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pulse-coder-engine')>();
  return {
    ...actual,
    PulseAgent: class {
      async initialize() {}

      async run(context: any, options: any) {
        return await agentMock.run?.(context, options) ?? 'done';
      }
    },
  };
});

import { printModeExitCode, runPrintMode } from './print-mode.js';

const originalConsole = {
  log: console.log,
  info: console.info,
  debug: console.debug,
};

afterEach(() => {
  agentMock.run = undefined;
  console.log = originalConsole.log;
  console.info = originalConsole.info;
  console.debug = originalConsole.debug;
  vi.restoreAllMocks();
});

describe('printModeExitCode', () => {
  it('maps benchmark termination reasons to stable process exit codes', () => {
    expect(printModeExitCode('completed')).toBe(0);
    expect(printModeExitCode('error')).toBe(1);
    expect(printModeExitCode('timeout')).toBe(124);
    expect(printModeExitCode('signal', 'SIGINT')).toBe(130);
    expect(printModeExitCode('signal', 'SIGTERM')).toBe(143);
    expect(printModeExitCode('token_budget')).toBe(2);
    expect(printModeExitCode('max_steps')).toBe(2);
  });
});

describe('runPrintMode message history', () => {
  it('adds each completed step response to the next iteration context', async () => {
    let messagesAfterResponse: unknown[] = [];
    agentMock.run = async (context, options) => {
      options.onResponse?.([
        { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'call-1' }] },
        { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call-1' }] },
      ]);
      messagesAfterResponse = [...context.messages];
      return 'done';
    };
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const exitCode = await runPrintMode('fix the bug');

    expect(exitCode).toBe(0);
    expect(messagesAfterResponse).toEqual([
      { role: 'user', content: 'fix the bug' },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'call-1' }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call-1' }] },
    ]);
  });

  it('replaces the active context when the engine compacts messages', async () => {
    let messagesAfterCompaction: unknown[] = [];
    const compactedMessages = [{ role: 'user', content: 'compacted context' }];
    agentMock.run = async (context, options) => {
      options.onCompacted?.(compactedMessages, { reason: 'token-threshold' });
      messagesAfterCompaction = context.messages;
      return 'done';
    };
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const exitCode = await runPrintMode('fix the bug');

    expect(exitCode).toBe(0);
    expect(messagesAfterCompaction).toBe(compactedMessages);
  });
});
