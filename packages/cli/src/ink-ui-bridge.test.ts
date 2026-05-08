import { describe, expect, it } from 'vitest';

import { InkUiBridge } from './ink-ui-bridge.js';
import {
  applySlashCommandCompletion,
  getSlashCommandSuggestions,
  insertAtCursor,
  removeAtCursor,
  removeBeforeCursor,
  removeWordBeforeCursor,
  renderPrompt,
  renderPromptLines,
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
    expect(events[1].title).toBe('bash');
    expect(events[2].text).toBe('after');
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

  it('suggests and completes slash commands', () => {
    expect(getSlashCommandSuggestions('/s', 2).map(item => item.command)).toEqual(['/sessions', '/search', '/skills', '/status', '/solo', '/save']);
    expect(getSlashCommandSuggestions('//', 2)).toEqual([]);
    expect(applySlashCommandCompletion('/sta', 4, '/status')).toEqual({ input: '/status ', cursor: 8 });
  });
});
