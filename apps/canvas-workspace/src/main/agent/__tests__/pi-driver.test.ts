import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AgentRoleDefinition } from '../../../shared/agent-roles';
import { buildPiArgs, consumePiStreamLine, createPiStreamState, piCommand, runPiSegment } from '../external/pi';
import { externalCliCommand } from '../external/runner';
import { runExternalRoleSegment } from '../external/segment';

let dir: string;

const role = (over: Partial<AgentRoleDefinition> = {}): AgentRoleDefinition => ({
  id: 'r-pi', name: 'pi工程师', color: '#2383e2', prompt: '',
  external: { family: 'pi', cwd: '/tmp/project' },
  createdAt: 0, updatedAt: 0,
  ...over,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'canvas-pi-'));
  process.env.PULSE_CANVAS_EXTERNAL_AGENT_STATE = join(dir, 'state.json');
});

afterEach(() => {
  delete process.env.PULSE_CANVAS_EXTERNAL_AGENT_STATE;
  delete process.env.PULSE_CANVAS_PI_CMD;
  rmSync(dir, { recursive: true, force: true });
});

describe('pi CLI wiring', () => {
  it('builds headless json args, adding --session only on resume and -e per extension', () => {
    expect(buildPiArgs({})).toEqual(['--mode', 'json', '-p']);
    expect(buildPiArgs({ sessionId: 'abc-123' })).toEqual(['--mode', 'json', '-p', '--session', 'abc-123']);
    expect(buildPiArgs({ extensionPaths: ['/opt/ext/pulse-canvas.ts'] }))
      .toEqual(['--mode', 'json', '-p', '-e', '/opt/ext/pulse-canvas.ts']);
  });

  it('honors the PULSE_CANVAS_PI_CMD override through the family dispatch', () => {
    expect(piCommand()).toBe('pi');
    process.env.PULSE_CANVAS_PI_CMD = '/opt/custom/pi';
    expect(piCommand()).toBe('/opt/custom/pi');
    expect(externalCliCommand('pi')).toBe('/opt/custom/pi');
  });

  it('turns a missing binary into an actionable install hint', async () => {
    process.env.PULSE_CANVAS_PI_CMD = join(dir, 'definitely-not-installed');
    await expect(runPiSegment({
      family: 'pi',
      cwd: dir,
      prompt: 'hi',
      abortSignal: new AbortController().signal,
      onText: () => {},
    })).rejects.toThrow(/npm install -g @earendil-works\/pi-coding-agent/);
  });
});

describe('pi json event parser', () => {
  it('captures the session header id and streams text deltas', () => {
    const state = createPiStreamState();
    const deltas: string[] = [];
    const feed = (obj: unknown) => consumePiStreamLine(state, JSON.stringify(obj), { onText: d => deltas.push(d) });

    // Real 0.83.0 header line shape (captured fixture).
    feed({ type: 'session', version: 3, id: '019fc33a-4397-7cc0-8a4d-56fc12836517', timestamp: '2026-08-02T16:06:43.351Z', cwd: '/tmp' });
    feed({ type: 'agent_start' });
    feed({ type: 'turn_start' });
    feed({ type: 'message_update', message: { role: 'assistant', content: [] }, assistantMessageEvent: { type: 'text_delta', delta: '改完了,' } });
    feed({ type: 'message_update', message: { role: 'assistant', content: [] }, assistantMessageEvent: { type: 'thinking_delta', delta: 'IGNORED' } });
    feed({ type: 'message_update', message: { role: 'assistant', content: [] }, assistantMessageEvent: { type: 'text_delta', delta: '细节见 diff。' } });
    consumePiStreamLine(state, 'not json at all', { onText: d => deltas.push(d) });
    feed({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: '改完了,细节见 diff。' }] } });
    feed({ type: 'turn_end', message: { role: 'assistant', content: [] }, toolResults: [] });
    feed({ type: 'agent_end', messages: [] });

    expect(deltas).toEqual(['改完了,', '细节见 diff。']);
    expect(state.sessionId).toBe('019fc33a-4397-7cc0-8a4d-56fc12836517');
    expect(state.finalText).toBe('改完了,细节见 diff。');
    expect(state.errorMessage).toBeUndefined();
  });

  it('falls back to the message_end text when no deltas arrive', () => {
    const state = createPiStreamState();
    const deltas: string[] = [];
    consumePiStreamLine(
      state,
      JSON.stringify({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: '直接完整文本' }] } }),
      { onText: d => deltas.push(d) },
    );
    expect(deltas).toEqual(['直接完整文本']);
    expect(state.finalText).toBe('直接完整文本');
  });

  it('surfaces an error-stop assistant message as the run error', () => {
    const state = createPiStreamState();
    // Real 0.83.0 auth-failure shape (captured fixture, trimmed).
    consumePiStreamLine(state, JSON.stringify({
      type: 'message_end',
      message: {
        role: 'assistant', content: [], api: 'anthropic-messages', provider: 'anthropic',
        model: 'claude-sonnet-4-5', stopReason: 'error',
        errorMessage: '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
      },
    }), { onText: () => {} });
    expect(state.errorMessage).toContain('authentication_error');
    expect(state.finalText).toBeUndefined();
  });

  it('translates tool_execution events into chips, tolerating end-without-start', () => {
    const state = createPiStreamState();
    const calls: any[] = [];
    const results: any[] = [];
    const handlers = { onText: () => {}, onToolCall: (e: any) => calls.push(e), onToolResult: (e: any) => results.push(e) };
    const feed = (obj: unknown) => consumePiStreamLine(state, JSON.stringify(obj), handlers);

    feed({ type: 'tool_execution_start', toolCallId: 'tc1', toolName: 'bash', args: { command: 'ls' } });
    feed({ type: 'tool_execution_end', toolCallId: 'tc1', toolName: 'bash', result: { content: [{ type: 'text', text: 'README.md' }] }, isError: false });
    // Robustness rule: a result whose call was never seen still emits a call.
    feed({ type: 'tool_execution_end', toolCallId: 'tc2', toolName: 'read', result: 'boom', isError: true });

    expect(calls[0]).toMatchObject({ name: 'bash', toolCallId: 'tc1', args: { command: 'ls' } });
    expect(results[0]).toMatchObject({ name: 'bash', toolCallId: 'tc1', status: 'succeeded', result: 'README.md' });
    expect(calls[1]).toMatchObject({ toolCallId: 'tc2' });
    expect(results[1]).toMatchObject({ toolCallId: 'tc2', status: 'failed', error: 'boom' });
  });

  it('ignores unmodeled event types so version drift degrades instead of crashing', () => {
    const state = createPiStreamState();
    const deltas: string[] = [];
    const feed = (obj: unknown) => consumePiStreamLine(state, JSON.stringify(obj), { onText: d => deltas.push(d) });
    feed({ type: 'queue_update', steering: [], followUp: [] });
    feed({ type: 'compaction_start', reason: 'threshold' });
    feed({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 500, errorMessage: 'overloaded' });
    expect(deltas).toEqual([]);
    expect(state.errorMessage).toBeUndefined();
  });
});

describe('pi segment orchestration (fake CLI)', () => {
  /** Executable fake `pi`: succeeds fresh, fails resumes with a stale-session error. */
  function installFakePi(): string {
    const path = join(dir, 'fake-pi');
    writeFileSync(path, [
      '#!/usr/bin/env node',
      "let input = '';",
      "process.stdin.on('data', (c) => { input += c; });",
      "process.stdin.on('end', () => {",
      "  if (process.argv.includes('--session')) {",
      "    process.stderr.write('No session found matching sess-old');",
      '    process.exit(1);',
      '  }',
      "  const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');",
      "  out({ type: 'session', version: 3, id: 'pi-sess-new', timestamp: 't', cwd: process.cwd() });",
      "  out({ type: 'agent_start' });",
      "  out({ type: 'message_update', message: { role: 'assistant', content: [] }, assistantMessageEvent: { type: 'text_delta', delta: '看完了,' } });",
      "  out({ type: 'tool_execution_start', toolCallId: 'tc1', toolName: 'read', args: { path: 'README.md' } });",
      "  out({ type: 'tool_execution_end', toolCallId: 'tc1', toolName: 'read', result: '# demo', isError: false });",
      "  out({ type: 'message_update', message: { role: 'assistant', content: [] }, assistantMessageEvent: { type: 'text_delta', delta: '没问题。' } });",
      "  out({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: '看完了,没问题。' }] } });",
      "  out({ type: 'agent_end', messages: [] });",
      '});',
    ].join('\n'));
    chmodSync(path, 0o755);
    return path;
  }

  it('runs a fresh session, streams tools, persists the announced session id, and retries stale resumes', async () => {
    process.env.PULSE_CANVAS_PI_CMD = installFakePi();
    const r = role({ external: { family: 'pi', cwd: dir } });
    const live: string[] = [];

    const { text, toolCalls } = await runExternalRoleSegment({
      role: r, external: r.external!, chatSessionId: 'chat-pi',
      history: [], currentAsk: '看看 README', handoffNames: [],
      abortSignal: new AbortController().signal, onText: () => {},
      onToolCall: e => live.push(`call:${e.name}`),
      onToolResult: e => live.push(`result:${e.name}`),
    });

    expect(text).toBe('看完了,没问题。');
    expect(live).toEqual(['call:read', 'result:read']);
    expect(toolCalls).toEqual([
      { id: 1, name: 'read', toolCallId: 'tc1', status: 'succeeded', args: { path: 'README.md' }, result: '# demo' },
    ]);

    // Second segment resumes with the stored id; the fake fails resumes with a
    // stale-session error, so the shared retry runs once fresh and succeeds.
    const second = await runExternalRoleSegment({
      role: r, external: r.external!, chatSessionId: 'chat-pi',
      history: [], currentAsk: '再看一遍', handoffNames: [],
      abortSignal: new AbortController().signal, onText: () => {},
    });
    expect(second.text).toBe('看完了,没问题。');
  });
});
