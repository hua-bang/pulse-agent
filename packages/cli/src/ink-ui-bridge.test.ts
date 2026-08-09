import { describe, expect, it } from 'vitest';

import { InkUiBridge } from './ink-ui-bridge.js';
import {
  applySlashCommandCompletion,
  filterPickerItems,
  formatElapsed,
  formatRelativeTime,
  formatStatusline,
  formatTokenCount,
  getSlashCommandSuggestions,
  truncateLabel,
  verticalCursorTarget,
  insertAtCursor,
  isPasteChunk,
  nextInteractionMode,
  nextWordIndex,
  normalizeInteractionMode,
  normalizePastedText,
  prevWordIndex,
  removeAtCursor,
  removeBeforeCursor,
  removeWordAfterCursor,
  removeWordBeforeCursor,
  renderPrompt,
  renderPromptLines,
  shouldAcceptSlashSuggestion,
  windowLiveTextLines,
  windowPromptRows,
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

  it('streams tool arguments into a live line that the final call replaces in place', () => {
    const { snapshots, bridge } = createBridge();

    bridge.toolInputStart('call-1', 'bash');
    bridge.toolInputDelta('call-1', '{"command":"pnpm te');

    let liveTools = snapshots[snapshots.length - 1].liveTools;
    expect(liveTools).toHaveLength(1);
    expect(liveTools[0].label).toContain('pnpm te');
    expect(liveTools[0].label).not.toContain('{');

    bridge.toolInputEnd('call-1');
    bridge.toolCall('bash', { command: 'pnpm test' }, 'call-1');

    liveTools = snapshots[snapshots.length - 1].liveTools;
    expect(liveTools).toHaveLength(1);
    expect(liveTools[0].label).toBe('$ pnpm test');

    bridge.toolResult('bash', 'ok', 'call-1');
    // The trace is held back a beat for a possible merge (see addToolTrace);
    // stopProcessing() is a terminal path and flushes it.
    bridge.stopProcessing();
    const last = snapshots[snapshots.length - 1];
    expect(last.liveTools).toHaveLength(0);
    expect(last.events.slice(-1)[0]).toMatchObject({ title: '$ pnpm test', summary: 'ok' });
  });

  it('resolves parallel tool results by call id', () => {
    const { snapshots, bridge } = createBridge();

    bridge.toolCall('grep', { pattern: 'one' }, 'call-a');
    bridge.toolCall('grep', { pattern: 'two' }, 'call-b');
    bridge.toolResult('grep', 'match-b', 'call-b');
    // The trace is held back a beat for a possible merge (see addToolTrace);
    // any other event kind (a log line here) flushes it — stopProcessing()
    // would wrongly also finalize the still-running "one" call.
    bridge.log('flush trigger');

    const last = snapshots[snapshots.length - 1];
    expect(last.liveTools).toHaveLength(1);
    expect(last.liveTools[0].label).toBe('grep "one"');
    expect(last.events.filter(event => event.kind === 'tool').slice(-1)[0]).toMatchObject({ title: 'grep "two"', summary: 'match-b' });
  });

  it('marks narration segments as interim and the closing segment as final', () => {
    const { snapshots, bridge } = createBridge();

    bridge.startProcessing('Running agent');
    bridge.text('narration before the tool');
    bridge.toolCall('bash', { command: 'echo ok' });
    bridge.toolResult('bash', 'ok');
    bridge.text('the actual answer');
    bridge.runSummary({ elapsedMs: 10, toolCalls: 1, messages: 2, estimatedTokens: 5, mode: 'chat' });

    const assistantEvents = snapshots[snapshots.length - 1].events.filter(event => event.kind === 'assistant');
    expect(assistantEvents).toHaveLength(2);
    expect(assistantEvents[0]).toMatchObject({ text: 'narration before the tool', status: 'info' });
    expect(assistantEvents[1].text).toBe('the actual answer');
    expect(assistantEvents[1].status).toBeUndefined();
  });

  it('folds narration segments to a one-line summary once collapse is on, off by default', () => {
    const { snapshots, bridge } = createBridge();

    expect(bridge.getNarrationCollapse()).toBe(false);
    bridge.startProcessing('Running agent');
    bridge.text('line one\nline two\nline three');
    bridge.toolCall('bash', { command: 'echo ok' });

    // Off by default: the full narration text is preserved.
    let narration = snapshots[snapshots.length - 1].events.find(event => event.status === 'info');
    expect(narration?.text).toBe('line one\nline two\nline three');

    bridge.setNarrationCollapse(true);
    expect(bridge.getNarrationCollapse()).toBe(true);
    expect(snapshots[snapshots.length - 1].events.some(event => event.kind === 'log' && event.text.includes('Narration: collapsed'))).toBe(true);

    bridge.text('folded one\nfolded two\nfolded three\nfolded four');
    bridge.toolCall('bash', { command: 'echo again' });

    const events = snapshots[snapshots.length - 1].events.filter(event => event.status === 'info');
    expect(events).toHaveLength(2);
    // Only a NEW narration segment is affected — the already-printed one above
    // is untouched (Static is append-only).
    expect(events[0].text).toBe('line one\nline two\nline three');
    expect(events[1].text).toBe('folded one … +3 lines');
  });

  it('never folds the final answer segment, and turning collapse off restores full narration', () => {
    const { snapshots, bridge } = createBridge();

    bridge.setNarrationCollapse(true);
    bridge.startProcessing('Running agent');
    bridge.text('narration line one\nnarration line two');
    bridge.toolCall('bash', { command: 'echo ok' });
    bridge.toolResult('bash', 'ok');
    bridge.text('final answer line one\nfinal answer line two');
    bridge.runSummary({ elapsedMs: 5, toolCalls: 1, messages: 2, estimatedTokens: 4, mode: 'chat' });

    const assistantEvents = snapshots[snapshots.length - 1].events.filter(event => event.kind === 'assistant');
    expect(assistantEvents[0]).toMatchObject({ text: 'narration line one … +1 line', status: 'info' });
    // The final segment is never folded, collapsed setting or not.
    expect(assistantEvents[1]).toMatchObject({ text: 'final answer line one\nfinal answer line two' });
    expect(assistantEvents[1].status).toBeUndefined();

    bridge.setNarrationCollapse(false);
    bridge.startProcessing('Running agent');
    bridge.text('back to full\nnarration text');
    bridge.toolCall('bash', { command: 'echo ok' });

    const restored = snapshots[snapshots.length - 1].events.filter(event => event.status === 'info').slice(-1)[0];
    expect(restored.text).toBe('back to full\nnarration text');
  });

  it('finalizes a tool call as a one-line summary by default', () => {
    const { snapshots, bridge } = createBridge();

    bridge.startProcessing('Running agent');
    bridge.toolCall('bash', { command: 'echo ok' });
    bridge.toolResult('bash', 'ok\nline2\nline3\nline4\nline5');
    // The trace is held back a beat for a possible merge (see addToolTrace);
    // stopProcessing() is a terminal path and flushes it.
    bridge.stopProcessing();

    const last = snapshots[snapshots.length - 1];
    expect(last.liveTools).toHaveLength(0);
    expect(last.toolCalls).toBe(1);
    expect(last.completedTools).toBe(1);

    const toolEvent = last.events[last.events.length - 1];
    expect(toolEvent).toMatchObject({
      kind: 'tool',
      title: '$ echo ok',
      summary: '5 lines',
      status: 'success',
    });
    expect(toolEvent.text).toBe('');
  });

  it('inlines single-line output and uses category nouns for counts', () => {
    const { snapshots, bridge } = createBridge();

    bridge.toolCall('bash', { command: 'echo ok' });
    bridge.toolResult('bash', 'ok');
    bridge.toolCall('grep', { pattern: 'test', path: 'src' });
    bridge.toolResult('grep', 'a.ts\nb.ts\nc.ts');
    bridge.toolCall('read', { filePath: 'src/loop.ts' });
    bridge.toolResult('read', { content: 'line1\nline2' });
    // The last trace is held back a beat for a possible merge (see
    // addToolTrace); any other event kind flushes it.
    bridge.log('flush trigger');

    // title and summary are kept as separate fields (see addToolTrace/
    // TranscriptEvent) so a long label cannot orphan-wrap the summary.
    const events = snapshots[snapshots.length - 1].events.filter(event => event.kind === 'tool');
    expect(events).toContainEqual(expect.objectContaining({ title: '$ echo ok', summary: 'ok' }));
    expect(events).toContainEqual(expect.objectContaining({ title: 'grep "test" in src', summary: '3 matches' }));
    expect(events).toContainEqual(expect.objectContaining({ title: 'open src/loop.ts', summary: '2 lines' }));
  });

  it('keeps the package segment of a long monorepo path instead of only the tail', () => {
    const { snapshots, bridge } = createBridge();

    // Old behavior kept only the last 2 segments ("…/directory/model-registry.ts"),
    // which throws away the one segment that actually tells packages apart in
    // a monorepo — most packages have a src/ and many share file basenames.
    bridge.toolCall('edit', { filePath: 'packages/cli/src/very/deeply/nested/directory/model-registry.ts' });
    const label = snapshots[snapshots.length - 1].liveTools[0].label;
    expect(label).toBe('edit packages/…/directory/model-registry.ts');

    // Still too long even with the head kept (the head segment itself is huge):
    // degrades to the old tail-only form.
    bridge.toolCall('edit', { filePath: 'a-package-name-that-is-extremely-long-and-verbose-for-testing-purposes/src/deeply/nested/model-registry.ts' });
    const longLabel = snapshots[snapshots.length - 1].liveTools[1].label;
    expect(longLabel).toBe('edit …/nested/model-registry.ts');

    // Short paths are untouched.
    bridge.toolCall('edit', { filePath: 'src/foo.ts' });
    expect(snapshots[snapshots.length - 1].liveTools[2].label).toBe('edit src/foo.ts');
  });

  it('shows content previews for new traces after enabling detail mode', () => {
    const { snapshots, bridge } = createBridge();

    bridge.setToolDetail(true);
    bridge.toolCall('bash', { command: 'echo ok' });
    bridge.toolResult('bash', 'ok\nline2\nline3\nline4\nline5');

    const events = snapshots[snapshots.length - 1].events;
    expect(events.some(event => event.kind === 'log' && event.text.includes('Detail: on'))).toBe(true);
    const toolEvent = events[events.length - 1];
    expect(toolEvent.title).toBe('$ echo ok');
    expect(toolEvent.summary).toBe('5 lines');
    expect(toolEvent.text).toContain('ok');
    expect(toolEvent.text).toContain('… +2 lines');
  });

  it('marks failed tool results as errors with the error inline', () => {
    const { snapshots, bridge } = createBridge();

    bridge.startProcessing('Running agent');
    bridge.toolCall('bash', { command: 'false' });
    bridge.toolResult('bash', { error: 'boom' });
    // The trace is held back a beat for a possible merge (see addToolTrace);
    // stopProcessing() is a terminal path and flushes it.
    bridge.stopProcessing();

    const toolEvent = snapshots[snapshots.length - 1].events.slice(-1)[0];
    expect(toolEvent.status).toBe('error');
    expect(toolEvent.title).toBe('$ false');
    expect(toolEvent.summary).toBe('boom');
    expect(toolEvent.text).toBe('');
  });

  it('does not misclassify sub-agent tools whose names embed a classifier word', () => {
    const { snapshots, bridge } = createBridge();

    // 're-SEARCH-er': substring matching branded this a search tool and dumped
    // the raw input JSON into every trace of a parallel sub-agent run.
    bridge.toolCall('researcher_agent', { task: '对当前仓库 packages/cli 的 Ink TUI 做只读 UX 审计', context: { depth: 1 } });

    const label = snapshots[snapshots.length - 1].liveTools[0].label;
    expect(label.startsWith('researcher_agent: 对当前仓库')).toBe(true);
    expect(label).not.toContain('{');
    expect(label).not.toContain('search ');

    // Whole-word matches keep working across separators.
    bridge.toolCall('web_search', { query: 'ink render throttle' });
    expect(snapshots[snapshots.length - 1].liveTools[1].label).toBe('search "ink render throttle"');
  });

  it('labels non-filesystem tools by their input instead of mislabeling as ls', () => {
    const { snapshots, bridge } = createBridge();

    bridge.toolCall('task_list', { action: 'list' });
    bridge.toolCall('skill', { name: 'task-tracking-workflow' });
    bridge.toolCall('ls', { path: 'packages/cli' });

    const liveTools = snapshots[snapshots.length - 1].liveTools;
    expect(liveTools.map(tool => tool.label)).toEqual([
      'task_list: list',
      'skill: task-tracking-workflow',
      'ls packages/cli',
    ]);
  });

  it('never dumps JSON for structured output without a text field', () => {
    const { snapshots, bridge } = createBridge();

    bridge.toolCall('task_list', { action: 'list' });
    bridge.toolResult('task_list', { taskListId: 'session-1', storagePath: '/Users/x/.pulse-coder/tasks/session-1.json', extras: 'y'.repeat(300) });
    // The trace is held back a beat for a possible merge (see addToolTrace);
    // any other event kind flushes it.
    bridge.log('flush trigger');

    const toolEvent = snapshots[snapshots.length - 1].events.filter(event => event.kind === 'tool').slice(-1)[0];
    expect(toolEvent.title).toBe('task_list: list');
    expect(toolEvent.text).toBe('');
  });

  it('shows and hides the modal picker via the snapshot', () => {
    const { snapshots, bridge } = createBridge();

    bridge.showPicker({
      title: 'Resume session',
      items: [{ id: 's1', label: 'Fix login page', hint: '12 msgs · 2h ago', preview: 'done' }],
    });

    let last = snapshots[snapshots.length - 1];
    expect(last.picker?.title).toBe('Resume session');
    expect(last.picker?.items).toHaveLength(1);
    expect(last.status).toBe('Resume session');

    bridge.hidePicker();
    last = snapshots[snapshots.length - 1];
    expect(last.picker).toBeNull();
    expect(last.status).toBe('Ready');
  });

  it('records engine log lines as compact log events', () => {
    const { snapshots, bridge } = createBridge();

    bridge.log('[warn] [MCP] Failed to load server "deepwiki"');

    const last = snapshots[snapshots.length - 1].events.slice(-1)[0];
    expect(last.kind).toBe('log');
    expect(last.text).toContain('deepwiki');
  });

  it('extracts text from MCP-style content parts', () => {
    const { snapshots, bridge } = createBridge();

    bridge.toolCall('search', { query: 'docs' });
    bridge.toolResult('search', { content: [{ type: 'text', text: 'part one' }, { type: 'text', text: 'part two' }] });
    // The trace is held back a beat for a possible merge (see addToolTrace);
    // any other event kind flushes it.
    bridge.log('flush trigger');

    const toolEvent = snapshots[snapshots.length - 1].events.filter(event => event.kind === 'tool').slice(-1)[0];
    expect(toolEvent.title).toBe('search "docs"');
    expect(toolEvent.summary).toBe('2 matches');
    expect(toolEvent.status).toBe('success');
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

  it('finalizes the live region on error, not just on abort', () => {
    const { snapshots, bridge } = createBridge();

    bridge.startProcessing('Running agent');
    bridge.text('partial answer before the failure');
    bridge.toolCall('bash', { command: 'sleep 100' });
    bridge.error('Error: provider connection reset');

    const last = snapshots[snapshots.length - 1];
    expect(last.liveText).toBe('');
    expect(last.liveTools).toHaveLength(0);
    expect(last.events.some(event => event.kind === 'assistant' && event.text.includes('partial answer'))).toBe(true);
    expect(last.events.some(event => event.kind === 'tool' && event.status === 'error')).toBe(true);
    expect(last.events.slice(-1)[0]).toMatchObject({ kind: 'error' });
  });

  it('marks the clarification phase so the composer can show its waiting state', () => {
    const { snapshots, bridge } = createBridge();

    bridge.clarification({ id: 'c1', question: 'Which package?', timeout: 0 } as never);

    const last = snapshots[snapshots.length - 1];
    expect(last.phase).toBe('Clarification');
    expect(last.status).toBe('Waiting for clarification');
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

  it('merges consecutive identical tool traces into one "· ×N" line', () => {
    const { snapshots, bridge } = createBridge();

    bridge.startProcessing('Running agent');
    bridge.toolCall('edit', { filePath: 'packages/cli/src/model-registry.ts' }, 'call-1');
    bridge.toolResult('edit', undefined, 'call-1');
    bridge.toolCall('edit', { filePath: 'packages/cli/src/model-registry.ts' }, 'call-2');
    bridge.toolResult('edit', undefined, 'call-2');
    bridge.toolCall('edit', { filePath: 'packages/cli/src/model-registry.ts' }, 'call-3');
    bridge.toolResult('edit', undefined, 'call-3');
    // The last of the three is still held back for a possible merge (see
    // addToolTrace); stopProcessing() is a terminal path and flushes it.
    bridge.stopProcessing();

    const toolEvents = snapshots[snapshots.length - 1].events.filter(event => event.kind === 'tool');
    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0].title).toBe('edit packages/cli/src/model-registry.ts ·×3');
  });

  it('does not merge different consecutive tool traces', () => {
    const { snapshots, bridge } = createBridge();

    bridge.startProcessing('Running agent');
    bridge.toolCall('edit', { filePath: 'a.ts' }, 'call-1');
    bridge.toolResult('edit', undefined, 'call-1');
    bridge.toolCall('edit', { filePath: 'b.ts' }, 'call-2');
    bridge.toolResult('edit', undefined, 'call-2');
    bridge.stopProcessing();

    const titles = snapshots[snapshots.length - 1].events
      .filter(event => event.kind === 'tool')
      .map(event => event.title);
    expect(titles).toEqual(['edit a.ts', 'edit b.ts']);
  });

  it('flushes a pending merged trace on abort instead of losing it', () => {
    const { snapshots, bridge } = createBridge();

    bridge.startProcessing('Running agent');
    bridge.toolCall('edit', { filePath: 'a.ts' }, 'call-1');
    bridge.toolResult('edit', undefined, 'call-1');
    bridge.toolCall('edit', { filePath: 'a.ts' }, 'call-2');
    bridge.toolResult('edit', undefined, 'call-2');
    // Nothing else happens before the run is cancelled — the merged trace for
    // the two "a.ts" edits above is still only pending, never printed yet.
    bridge.abort('stopped');

    const toolEvents = snapshots[snapshots.length - 1].events.filter(event => event.kind === 'tool');
    // The pending merged edit trace must survive the abort (not just the
    // "(cancelled)" entry for whatever tool was still live).
    expect(toolEvents.some(event => event.title === 'edit a.ts ·×2')).toBe(true);
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
    bridge.usage({ inputTokens: 1200, outputTokens: 340, cachedInputTokens: 900 });
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
    expect(last.usageCachedTokens).toBe(900);
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

  it('deletes whole code points, never half a surrogate pair', () => {
    expect(removeBeforeCursor({ input: 'a🚀', cursor: 3 })).toEqual({ input: 'a', cursor: 1 });
    expect(removeAtCursor({ input: 'a🚀b', cursor: 1 })).toEqual({ input: 'ab', cursor: 1 });
  });

  it('moves the cursor by line inside a multi-line draft and defers to history otherwise', () => {
    const draft = 'first line\nsecond';
    // column 3 on line 2 -> column 3 on line 1
    expect(verticalCursorTarget(draft, 14, -1)).toBe(3);
    // back down again
    expect(verticalCursorTarget(draft, 3, 1)).toBe(14);
    // no line above/below -> null, so ↑/↓ falls through to history
    expect(verticalCursorTarget(draft, 3, -1)).toBeNull();
    expect(verticalCursorTarget(draft, 14, 1)).toBeNull();
    expect(verticalCursorTarget('single line', 4, -1)).toBeNull();
  });

  it('clamps the column when the target line is shorter', () => {
    expect(verticalCursorTarget('ab\nlonger line', 12, -1)).toBe(2);
  });

  it('deletes the previous word and clamps prompt cursor', () => {
    expect(removeWordBeforeCursor({ input: 'run the agent', cursor: 13 })).toEqual({ input: 'run the ', cursor: 8 });
    expect(removeWordBeforeCursor({ input: 'run   ', cursor: 6 })).toEqual({ input: '', cursor: 0 });
    expect(renderPrompt('abc', 99, true)).toBe('abc█');
  });

  describe('word navigation (Alt+←/→, Alt+D, Ctrl+Delete)', () => {
    it('nextWordIndex skips whitespace then eats one word, symmetric with removeWordBeforeCursor\'s search', () => {
      expect(nextWordIndex('foo bar baz', 0)).toBe(3);
      expect(nextWordIndex('foo bar baz', 3)).toBe(7);
      // Multiple spaces are skipped as a unit before the word is eaten.
      expect(nextWordIndex('foo   bar', 3)).toBe(9);
      // Already at the end: no further movement.
      expect(nextWordIndex('foo', 3)).toBe(3);
    });

    it('prevWordIndex mirrors removeWordBeforeCursor\'s boundary search', () => {
      expect(prevWordIndex('foo bar baz', 11)).toBe(8);
      expect(prevWordIndex('foo bar baz', 8)).toBe(4);
      expect(prevWordIndex('foo bar   ', 10)).toBe(4);
      expect(prevWordIndex('foo', 0)).toBe(0);
    });

    it('steps over exactly one newline at a line boundary instead of standing still', () => {
      // Word movement is bounded to the current line (must not eat the \n as
      // if it were ordinary whitespace connecting two lines), but a press
      // sitting right on the boundary still has to make progress — one line
      // at a time, the same contract verticalCursorTarget keeps.
      const input = 'foo\nbar';
      expect(nextWordIndex(input, 3)).toBe(4);
      expect(prevWordIndex(input, 4)).toBe(3);
      // From well inside "foo", forward movement stops at the line's end
      // rather than reaching into "bar" in one step.
      expect(nextWordIndex(input, 0)).toBe(3);
    });

    it('removeWordAfterCursor deletes the word after the cursor without eating trailing whitespace', () => {
      expect(removeWordAfterCursor({ input: 'foo bar baz', cursor: 0 })).toEqual({ input: ' bar baz', cursor: 0 });
      expect(removeWordAfterCursor({ input: 'foo bar baz', cursor: 3 })).toEqual({ input: 'foo baz', cursor: 3 });
      // Cursor already at the end: nothing to delete.
      expect(removeWordAfterCursor({ input: 'foo', cursor: 3 })).toEqual({ input: 'foo', cursor: 3 });
    });

    it('removeWordAfterCursor never deletes across a line boundary', () => {
      // Cursor right before the \n: a delete-forward-word must not splice
      // "foo" and "bar" together by eating the newline between them.
      expect(removeWordAfterCursor({ input: 'foo\nbar', cursor: 3 })).toEqual({ input: 'foo\nbar', cursor: 3 });
    });
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
    expect(getSlashCommandSuggestions('/s', 2).map(item => item.command)).toEqual(['/sessions', '/search', '/skills', '/status', '/save', '/resume']);
    expect(getSlashCommandSuggestions('/md', 3).map(item => item.command)).toContain('/model');
    expect(getSlashCommandSuggestions('//', 2)).toEqual([]);
    expect(shouldAcceptSlashSuggestion('/sta', 4, getSlashCommandSuggestions('/sta', 4)[0])).toBe(true);
    expect(shouldAcceptSlashSuggestion('/status', 7, getSlashCommandSuggestions('/status', 7)[0])).toBe(false);
    expect(applySlashCommandCompletion('/sta', 4, '/status')).toEqual({ input: '/status ', cursor: 8 });
  });

  it('merges runtime skills into the palette without letting them shadow built-ins', () => {
    const skills = [
      { name: 'branch-naming', description: 'Name a branch' },
      { name: 'status', description: 'a skill that must not shadow /status' },
    ];

    const skillHit = getSlashCommandSuggestions('/br', 3, 6, skills);
    expect(skillHit.map(item => item.command)).toEqual(['/branch-naming']);
    expect(skillHit[0].group).toBe('Skill');
    expect(skillHit[0].usage).toBe('/branch-naming <message>');

    // The colliding skill is dropped entirely; /status stays the built-in.
    const statusHits = getSlashCommandSuggestions('/status', 7, 6, skills);
    expect(statusHits.map(item => item.command)).toEqual(['/status']);
    expect(statusHits[0].group).toBe('Core');

    // Built-ins outrank skills at equal score.
    const retired = getSlashCommandSuggestions('/team', 5, 6, skills);
    expect(retired).toEqual([]);
  });

  it('normalizes interaction modes and formats statusline', () => {
    expect(normalizeInteractionMode(undefined)).toBe('edit');
    expect(normalizeInteractionMode('planning')).toBe('plan');
    expect(normalizeInteractionMode('executing')).toBe('edit');
    expect(normalizeInteractionMode('chat')).toBe('edit');
    expect(nextInteractionMode('edit')).toBe('plan');
    expect(nextInteractionMode('plan')).toBe('edit');
    expect(nextInteractionMode('auto')).toBe('plan');

    const statusline = formatStatusline({
      sessionId: 'session-1234567890',
      taskListId: null,
      mode: 'plan',
      messages: 0,
      estimatedTokens: 96,
      usageInputTokens: 1500,
      usageOutputTokens: 20,
      usageCachedTokens: 1230,
      contextWindowTokens: 64000,
      modelLabel: 'deepseek_v3',
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

    expect(statusline).toContain('plan');
    expect(statusline).toContain('deepseek_v3');
    expect(statusline).toContain('ctx ~1.5k (2%)');
    expect(statusline).toContain('cache 82%');
    expect(statusline).toContain('out ~20');
    expect(statusline).toContain('tools 1/3');
    expect(statusline).toContain('queue 2');
  });

  it('sheds low-priority status segments when the terminal is narrow', () => {
    const snapshot: InkCliSnapshot = {
      sessionId: 'session-1234567890',
      taskListId: null,
      mode: 'edit',
      messages: 0,
      estimatedTokens: 0,
      usageInputTokens: 43000,
      usageOutputTokens: 36000,
      usageCachedTokens: 43000,
      contextWindowTokens: 64000,
      modelLabel: 'deepseek-v4-flash',
      queuedInputs: 0,
      isProcessing: false,
      status: 'Ready',
      phase: 'Idle',
      activeTool: null,
      toolCalls: 17,
      completedTools: 17,
      lastStep: null,
      events: [],
      liveText: '',
      liveTools: [],
    };

    const wide = formatStatusline(snapshot, 200);
    expect(wide).toContain('out ~36k');
    expect(wide).toContain('cache 100%');

    const narrow = formatStatusline(snapshot, 40);
    expect(narrow.length).toBeLessThanOrEqual(40);
    // Essentials survive, tail segments are shed.
    expect(narrow.startsWith('edit · ctx ~43k (67%)')).toBe(true);
    expect(narrow).not.toContain('out ~36k');

    // The first segment is never dropped, even at an absurd width.
    expect(formatStatusline(snapshot, 1)).toBe('edit');
  });

  it('truncates over-wide live tool labels', () => {
    expect(truncateLabel('short', 20)).toBe('short');
    expect(truncateLabel('a'.repeat(30), 10)).toBe(`${'a'.repeat(9)}…`);
    expect(truncateLabel('abc', 0)).toBe('abc');
  });

  it('keeps the streaming answer inside its row budget', () => {
    const lines = Array.from({ length: 40 }, (_, index) => `line ${index}`);

    // Fits: nothing is hidden and the text is passed through untouched.
    expect(windowLiveTextLines(lines, 40, 80)).toEqual({ lines, hiddenLineCount: 0 });

    // Over budget: the tail survives and one row is left for the "… N earlier
    // lines" head, so the region occupies exactly the budget and no more.
    const windowed = windowLiveTextLines(lines, 10, 80);
    expect(windowed.lines).toEqual(lines.slice(31));
    expect(windowed.hiddenLineCount).toBe(31);
    expect(windowed.lines.length + 1).toBe(10);
    expect(windowed.lines[windowed.lines.length - 1]).toBe('line 39');
  });

  it('charges wrapped lines their real height when windowing', () => {
    // Each of these is three physical rows on a 10-column terminal, so a
    // 7-row budget (6 after the head) fits exactly two of them.
    const lines = Array.from({ length: 5 }, (_, index) => `${index}${'x'.repeat(29)}`);
    const windowed = windowLiveTextLines(lines, 7, 10);

    expect(windowed.lines).toHaveLength(2);
    expect(windowed.hiddenLineCount).toBe(3);
  });

  it('hides the streaming answer entirely when no rows are left', () => {
    const lines = ['a', 'b'];
    expect(windowLiveTextLines(lines, 0, 80)).toEqual({ lines: [], hiddenLineCount: 2 });
    expect(windowLiveTextLines(lines, -3, 80)).toEqual({ lines: [], hiddenLineCount: 2 });
    // A single row would go entirely to the head, showing none of the answer.
    expect(windowLiveTextLines(lines, 1, 80)).toEqual({ lines: [], hiddenLineCount: 2 });
    expect(windowLiveTextLines([], 5, 80)).toEqual({ lines: [], hiddenLineCount: 0 });
  });

  it('drops streaming events that arrive after an abort', () => {
    const { snapshots, bridge } = createBridge();

    bridge.startProcessing('Running agent');
    bridge.text('partial ans');
    bridge.abort('Request cancelled by Esc.');

    const afterAbort = snapshots.length;
    const cancelled = snapshots[afterAbort - 1];
    expect(cancelled.status).toBe('Cancelled');

    // The model keeps streaming until its current step unwinds. None of it may
    // reach the UI: text would paint a bright fragment under a Cancelled
    // status, a tool call would spin a live line nothing will ever retire, and
    // either one resurrects the live region so a second Esc writes a second
    // permanent Abort block.
    bridge.text(' that kept coming');
    bridge.toolInputStart('call-late', 'bash');
    bridge.toolInputDelta('call-late', '{"command":"rm -rf"');
    bridge.toolCall('bash', { command: 'late call' }, 'call-late');
    bridge.toolResult('bash', 'late result', 'call-late');

    expect(snapshots).toHaveLength(afterAbort);
    const latest = bridge.getSnapshot();
    expect(latest.liveText).toBe('');
    expect(latest.liveTools).toEqual([]);
    expect(latest.events).toEqual(cancelled.events);

    // A second Esc still finds nothing live, so it stays deduped.
    bridge.abort('Request cancelled by Esc.');
    expect(bridge.getSnapshot().events.filter(event => event.title === 'Abort')).toHaveLength(1);
  });

  it('streams normally again on the next run', () => {
    const { bridge } = createBridge();

    bridge.startProcessing('Running agent');
    bridge.abort('Request cancelled by Esc.');
    bridge.text('ignored');

    bridge.startProcessing('Running agent');
    bridge.text('the next answer');
    bridge.toolCall('bash', { command: 'echo ok' }, 'call-2');
    bridge.toolResult('bash', 'ok', 'call-2');
    // The trace is held back a beat for a possible merge (see addToolTrace);
    // stopProcessing() is a terminal path and flushes it.
    bridge.stopProcessing();

    const snapshot = bridge.getSnapshot();
    expect(snapshot.events.some(event => event.text.includes('the next answer'))).toBe(true);
    expect(snapshot.events.some(event => event.text.includes('ignored'))).toBe(false);
    expect(snapshot.events.some(event => event.kind === 'tool' && event.title?.includes('echo ok'))).toBe(true);
  });

  it('bounds the draft by physical rows, not by logical lines', () => {
    // One pasted URL: a single logical line, ten physical rows at 50 columns.
    // A window counting logical lines calls this "1 line" and lets the composer
    // grow past the viewport.
    const windowed = windowPromptRows(renderPromptLines('x'.repeat(500), 500, true), 6, 50);

    expect(windowed.rows).toHaveLength(6);
    expect(windowed.hiddenRowCount).toBe(5);
    // Pre-wrapped: every row fits, so Ink cannot reflow one into extra rows.
    expect(windowed.rows.every(row => row.length <= 50)).toBe(true);
    // The cursor is at the end of the paste, so the tail is what shows.
    expect(windowed.rows[windowed.rows.length - 1]).toContain('█');
  });

  it('keeps the cursor row visible when editing the head of a long draft', () => {
    const windowed = windowPromptRows(renderPromptLines('y'.repeat(500), 0, true), 4, 50);

    expect(windowed.rows).toHaveLength(4);
    expect(windowed.hiddenRowCount).toBe(0);
    expect(windowed.rows[0].startsWith('█')).toBe(true);
  });

  it('passes a draft that fits through untouched', () => {
    const lines = renderPromptLines('first\nsecond', 12, true);
    expect(windowPromptRows(lines, 6, 50)).toEqual({ rows: lines, hiddenRowCount: 0 });
    // Never collapses to nothing: a budget of zero still shows the cursor row.
    expect(windowPromptRows(['a', 'b', 'c'], 0, 50).rows).toHaveLength(1);
  });

  it('filters picker items across label, hint, and preview', () => {
    const items = [
      { id: 'a', label: '修复登录页样式', hint: '12 msgs', preview: '改了按钮颜色' },
      { id: 'b', label: 'Refactor CLI', hint: '3 msgs', preview: 'ink rewrite' },
    ];
    expect(filterPickerItems(items, '')).toHaveLength(2);
    expect(filterPickerItems(items, '登录').map(item => item.id)).toEqual(['a']);
    expect(filterPickerItems(items, 'INK').map(item => item.id)).toEqual(['b']);
    expect(filterPickerItems(items, '按钮')).toHaveLength(1);
    expect(filterPickerItems(items, 'nope')).toHaveLength(0);
  });

  it('formats relative time for picker hints', () => {
    const now = 1_000_000_000_000;
    expect(formatRelativeTime(now - 30_000, now)).toBe('just now');
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5m ago');
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe('2d ago');
  });

  it('formats token counts and elapsed durations for the status line', () => {
    expect(formatTokenCount(950)).toBe('950');
    expect(formatTokenCount(1500)).toBe('1.5k');
    expect(formatTokenCount(2000)).toBe('2k');
    expect(formatTokenCount(144437)).toBe('144k');
    expect(formatElapsed(9000)).toBe('9s');
    expect(formatElapsed(130000)).toBe('2m10s');
  });
});
