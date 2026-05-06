import { describe, expect, it } from 'vitest';

import { InkUiBridge } from './ink-ui-bridge.js';
import type { InkCliSnapshot } from './ink-app.js';

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
