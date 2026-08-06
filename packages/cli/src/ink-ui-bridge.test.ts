import { describe, expect, it } from 'vitest';

import { InkUiBridge } from './ink-ui-bridge.js';
import {
  applySlashCommandCompletion,
  formatStatusline,
  getSlashCommandSuggestions,
  insertAtCursor,
  isPasteChunk,
  nextInteractionMode,
  normalizeInteractionMode,
  normalizePastedText,
  removeAtCursor,
  removeBeforeCursor,
  removeWordBeforeCursor,
  renderPrompt,
  renderPromptLines,
  shouldAcceptSlashSuggestion,
  type InkCliSnapshot,
} from './ink-app.js';

const createBridge = () => {
  const snapshots: InkCliSnapshot[] = [];
  const bridge = new InkUiBridge({
    onChange: snapshot => snapshots.push(snapshot),
    textThrottleMs: 0,
  });
  return { snapshots, bridge };
};

describe('InkUiBridge', () => {
  it('streams deltas into liveText without finalizing events', () => {
    const { snapshots, bridge } = createBridge();

    bridge.text('hello');
    bridge.text(' world');

    const last = snapshots[snapshots.length - 1];
    expect(last.liveText).toBe('hello world');
    expect(last.events).toHaveLength(0);
  });

  it('finalizes streaming text into an assistant event when a tool call starts', () => {
    const { snapshots, bridge } = createBridge();

    bridge.text('before');
    bridge.toolCall('bash', { command: 'echo ok' });

    const last = snapshots[snapshots.length - 1];
    expect(last.events.map(event => event.kind)).toEqual(['assistant']);
    expect(last.events[0].text).toBe('before');
    expect(last.liveText).toBe('');
    expect(last.liveTools).toHaveLength(1);
    expect(last.liveTools[0].label).toBe('$ echo ok');
  });

  it('finalizes a tool call with a success preview of its output', () => {
    const { snapshots, bridge } = createBridge();

    bridge.startProcessing('Running agent');
    bridge.toolCall('bash', { command: 'echo ok' });
    bridge.toolResult('bash', 'ok\nline2\nline3\nline4\nline5');

    const last = snapshots[snapshots.length - 1];
    expect(last.liveTools).toHaveLength(0);
    expect(last.toolCalls).toBe(1);
    expect(last.completedTools).toBe(1);

    const toolEvent = last.events[last.events.length - 1];
    expect(toolEvent).toMatchObject({
      kind: 'tool',
      title: '$ echo ok',
      status: 'success',
    });
    expect(toolEvent.text).toContain('ok');
    expect(toolEvent.text).toContain('… +2 lines');
  });

  it('marks failed tool results as errors', () => {
    const { snapshots, bridge } = createBridge();

    bridge.startProcessing('Running agent');
    bridge.toolCall('bash', { command: 'false' });
    bridge.toolResult('bash', { error: 'boom' });

    const toolEvent = snapshots[snapshots.length - 1].events.slice(-1)[0];
    expect(toolEvent.status).toBe('error');
    expect(toolEvent.text).toContain('boom');
  });

  it('extracts text from MCP-style content parts', () => {
    const { snapshots, bridge } = createBridge();

    bridge.toolCall('search', { query: 'docs' });
    bridge.toolResult('search', { content: [{ type: 'text', text: 'part one' }, { type: 'text', text: 'part two' }] });

    const toolEvent = snapshots[snapshots.length - 1].events.slice(-1)[0];
    expect(toolEvent.text).toContain('part one');
    expect(toolEvent.text).toContain('part two');
  });

  it('finalizes leftover live text on run summary', () => {
    const { snapshots, bridge } = createBridge();

    bridge.startProcessing('Running agent');
    bridge.text('final answer');
    bridge.runSummary({
      elapsedMs: 1234,
      toolCalls: 0,
      messages: 2,
      estimatedTokens: 12,
      mode: 'chat',
    });

    const last = snapshots[snapshots.length - 1];
    expect(last.liveText).toBe('');
    expect(last.events.some(event => event.kind === 'assistant' && event.text === 'final answer')).toBe(true);
    expect(last.isProcessing).toBe(false);
    expect(last.status).toContain('Done in 1.2s');
  });

  it('finalizes still-running tools as cancelled on abort', () => {
    const { snapshots, bridge } = createBridge();

    bridge.startProcessing('Running agent');
    bridge.toolCall('bash', { command: 'sleep 100' });
    bridge.abort('stopped');

    const last = snapshots[snapshots.length - 1];
    expect(last.liveTools).toHaveLength(0);
    const kinds = last.events.map(event => `${event.kind}:${event.status ?? ''}`);
    expect(kinds).toContain('tool:error');
    expect(last.events.slice(-1)[0]).toMatchObject({ kind: 'error', title: 'Abort' });
    expect(last.status).toBe('Cancelled');
  });

  it('throttles streaming emissions but keeps the snapshot current', () => {
    const snapshots: InkCliSnapshot[] = [];
    const bridge = new InkUiBridge({
      onChange: snapshot => snapshots.push(snapshot),
      textThrottleMs: 5000,
    });

    bridge.text('a');
    bridge.text('b');
    bridge.text('c');

    // First delta emits immediately; the rest coalesce into a pending flush.
    expect(snapshots).toHaveLength(1);
    expect(bridge.getSnapshot().liveText).toBe('abc');

    bridge.emit();
    expect(snapshots[snapshots.length - 1].liveText).toBe('abc');
  });

  it('updates session snapshot, usage, and run summary status', () => {
    const { snapshots, bridge } = createBridge();

    bridge.session({
      sessionId: 's1',
      taskListId: 'tasks-s1',
      messages: 3,
      estimatedTokens: 42,
      mode: 'executing',
    });
    bridge.usage({ inputTokens: 1200, outputTokens: 340 });
    bridge.runSummary({
      elapsedMs: 1234,
      toolCalls: 2,
      messages: 5,
      estimatedTokens: 64,
      mode: 'planning',
    });

    const last = snapshots[snapshots.length - 1];
    expect(last.sessionId).toBe('s1');
    expect(last.taskListId).toBe('tasks-s1');
    expect(last.messages).toBe(5);
    expect(last.estimatedTokens).toBe(64);
    expect(last.usageInputTokens).toBe(1200);
    expect(last.usageOutputTokens).toBe(340);
    expect(last.mode).toBe('planning');
    expect(last.isProcessing).toBe(false);
    expect(last.status).toContain('Done in 1.2s');
  });
});

describe('Ink composer editing helpers', () => {
  it('inserts and deletes at cursor position', () => {
    expect(insertAtCursor({ input: 'helo', cursor: 2 }, 'l')).toEqual({ input: 'hello', cursor: 3 });
    expect(removeBeforeCursor({ input: 'hello', cursor: 3 })).toEqual({ input: 'helo', cursor: 2 });
    expect(removeAtCursor({ input: 'hello', cursor: 1 })).toEqual({ input: 'hllo', cursor: 1 });
  });

  it('deletes the previous word and clamps prompt cursor', () => {
    expect(removeWordBeforeCursor({ input: 'run the agent', cursor: 13 })).toEqual({ input: 'run the ', cursor: 8 });
    expect(removeWordBeforeCursor({ input: 'run   ', cursor: 6 })).toEqual({ input: '', cursor: 0 });
    expect(renderPrompt('abc', 99, true)).toBe('abc█');
  });

  it('renders multiline prompts with cursor placement', () => {
    expect(renderPromptLines('one\ntwo', 4, true)).toEqual(['one', '█two']);
  });

  it('treats multi-character chunks as paste and normalizes them', () => {
    expect(isPasteChunk('a')).toBe(false);
    expect(isPasteChunk('ab')).toBe(true);
    expect(normalizePastedText('line1\r\nline2\rline3')).toBe('line1\nline2\nline3');
    expect(normalizePastedText('\x1b[200~pasted\x1b[201~')).toBe('pasted');
  });

  it('suggests, fuzzily matches, and completes slash commands', () => {
    expect(getSlashCommandSuggestions('/s', 2).map(item => item.command)).toEqual(['/sessions', '/search', '/skills', '/status', '/solo', '/save']);
    expect(getSlashCommandSuggestions('/tm', 3).map(item => item.command)).toContain('/team');
    expect(getSlashCommandSuggestions('//', 2)).toEqual([]);
    expect(shouldAcceptSlashSuggestion('/sta', 4, getSlashCommandSuggestions('/sta', 4)[0])).toBe(true);
    expect(shouldAcceptSlashSuggestion('/status', 7, getSlashCommandSuggestions('/status', 7)[0])).toBe(false);
    expect(applySlashCommandCompletion('/sta', 4, '/status')).toEqual({ input: '/status ', cursor: 8 });
  });

  it('normalizes interaction modes and formats statusline', () => {
    expect(normalizeInteractionMode(undefined)).toBe('chat');
    expect(normalizeInteractionMode('planning')).toBe('plan');
    expect(normalizeInteractionMode('executing')).toBe('edit');
    expect(nextInteractionMode('auto')).toBe('chat');

    const statusline = formatStatusline({
      sessionId: 'session-1234567890',
      taskListId: null,
      mode: 'plan',
      messages: 0,
      estimatedTokens: 96,
      usageInputTokens: 1500,
      usageOutputTokens: 20,
      queuedInputs: 2,
      isProcessing: true,
      status: 'Running agent',
      phase: 'Using tool',
      activeTool: 'bash',
      toolCalls: 3,
      completedTools: 1,
      lastStep: null,
      events: [],
      liveText: '',
      liveTools: [],
    });

    expect(statusline).toContain('mode plan');
    expect(statusline).toContain('ctx ~1500');
    expect(statusline).toContain('active bash');
    expect(statusline).toContain('tools 1/3');
    expect(statusline).toContain('queue 2');
    expect(statusline).toContain('session session-');
  });
});
