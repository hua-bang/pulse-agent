import { describe, expect, it } from 'vitest';

import { InkUiBridge } from './ink-ui-bridge.js';
import {
  applySlashCommandCompletion,
  formatStatusline,
  getSlashCommandSuggestions,
  insertAtCursor,
  nextInteractionMode,
  normalizeInteractionMode,
  removeAtCursor,
  removeBeforeCursor,
  removeWordBeforeCursor,
  renderPrompt,
  renderPromptLines,
  shouldAcceptSlashSuggestion,
  type InkCliSnapshot,
} from './ink-app.js';

describe('InkUiBridge', () => {
  it('streams assistant deltas into one assistant event', () => {
    const snapshots: InkCliSnapshot[] = [];
    const bridge = new InkUiBridge({ onChange: snapshot => snapshots.push(snapshot) });

    bridge.text('hello');
    bridge.text(' world');

    const last = snapshots[snapshots.length - 1];
    expect(last.events).toHaveLength(1);
    expect(last.events[0]).toMatchObject({
      kind: 'assistant',
      text: 'hello world',
    });
  });

  it('resets assistant stream when a tool call is shown', () => {
    const snapshots: InkCliSnapshot[] = [];
    const bridge = new InkUiBridge({ onChange: snapshot => snapshots.push(snapshot) });

    bridge.text('before');
    bridge.toolCall('bash', { command: 'echo ok' });
    bridge.text('after');

    const events = snapshots[snapshots.length - 1].events;
    expect(events.map(event => event.kind)).toEqual(['assistant', 'tool', 'assistant']);
    expect(events[1].title).toBe('Tools');
    expect(events[2].text).toBe('after');
  });

  it('updates one tool card through running and success lifecycle', () => {
    const snapshots: InkCliSnapshot[] = [];
    const bridge = new InkUiBridge({ onChange: snapshot => snapshots.push(snapshot) });

    bridge.startProcessing('Running agent');
    bridge.toolCall('bash', { command: 'echo ok' });
    bridge.toolResult('bash');

    const last = snapshots[snapshots.length - 1];
    expect(last.toolCalls).toBe(1);
    expect(last.completedTools).toBe(1);
    expect(last.activeTool).toBeNull();
    expect(last.events).toHaveLength(1);
    expect(last.events[0]).toMatchObject({
      kind: 'tool',
      title: 'Tools',
      status: 'success',
      summary: '1 call completed',
    });
  });
  it('groups multiple tool calls into one compact activity event', () => {
    const snapshots: InkCliSnapshot[] = [];
    const bridge = new InkUiBridge({ onChange: snapshot => snapshots.push(snapshot) });

    bridge.startProcessing('Running agent');
    bridge.toolCall('read', { filePath: 'packages/cli/src/ink-app.tsx' });
    bridge.toolResult('read');
    bridge.toolCall('grep', { pattern: 'toolCall', path: 'packages/cli/src' });
    bridge.toolResult('grep');

    const last = snapshots[snapshots.length - 1];
    expect(last.toolCalls).toBe(2);
    expect(last.completedTools).toBe(2);
    expect(last.events).toHaveLength(1);
    expect(last.events[0]).toMatchObject({
      kind: 'tool',
      title: 'Tools',
      status: 'success',
      summary: '2 calls completed',
    });
    expect(last.events[0].text).toContain('read ×1');
    expect(last.events[0].text).toContain('grep ×1');
    expect(last.events[0].text).toContain('✓ read  packages/cli/src/ink-app.tsx');
    expect(last.events[0].text).toContain('✓ grep  "toolCall" in packages/cli/src');
  });

  it('shows running progress in the compact tools summary', () => {
    const snapshots: InkCliSnapshot[] = [];
    const bridge = new InkUiBridge({ onChange: snapshot => snapshots.push(snapshot) });

    bridge.startProcessing('Running agent');
    bridge.toolCall('read', { filePath: 'packages/cli/src/ink-app.tsx' });
    bridge.toolResult('read');
    bridge.toolCall('bash', { command: 'pnpm --filter pulse-coder-cli test -- --runInBand' });

    const last = snapshots[snapshots.length - 1];
    expect(last.events).toHaveLength(1);
    expect(last.events[0]).toMatchObject({
      kind: 'tool',
      title: 'Tools',
      status: 'running',
      summary: '2 calls · 1 done · running bash',
    });
    expect(last.events[0].text).toContain('read ×1 · bash ×1');
    expect(last.events[0].text).toContain('latest');
    expect(last.events[0].text).toContain('… bash  pnpm --filter pulse-coder-cli test -- --runInBand');
  });

  it('updates session snapshot and run summary status', () => {
    const snapshots: InkCliSnapshot[] = [];
    const bridge = new InkUiBridge({ onChange: snapshot => snapshots.push(snapshot) });

    bridge.session({
      sessionId: 's1',
      taskListId: 'tasks-s1',
      messages: 3,
      estimatedTokens: 42,
      mode: 'executing',
    });
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
      sessionId: 's1',
      taskListId: null,
      mode: 'plan',
      messages: 0,
      estimatedTokens: 0,
      queuedInputs: 2,
      isProcessing: true,
      status: 'Running agent',
      phase: 'Using tool',
      activeTool: 'bash',
      toolCalls: 3,
      completedTools: 1,
      events: [],
    });

    expect(statusline).toContain('mode plan');
    expect(statusline).toContain('active bash');
    expect(statusline).toContain('tools 1/3');
    expect(statusline).toContain('queue 2');
  });
});
