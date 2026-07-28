import { describe, expect, it } from 'vitest';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { AgentChatMessage } from '../../../types';
import type { ToolCallStatus } from '../types';
import {
  applyTurnCompletion,
  createRelayTurnHandlers,
  createSegmentState,
  type RelayProgress,
} from './relayTurnHandlers';

/** Minimal useState-like harness: applies functional updates immediately. */
function stateRef<T>(initial: T): { value: T; set: Dispatch<SetStateAction<T>> } {
  const ref = {
    value: initial,
    set: (update: SetStateAction<T>) => {
      ref.value = typeof update === 'function' ? (update as (prev: T) => T)(ref.value) : update;
    },
  };
  return ref;
}

function harness() {
  const segment = createSegmentState();
  const messages = stateRef<AgentChatMessage[]>([
    { role: 'user', content: '@[role:r1|产品经理] @[role:r2|架构师] 一起评审', timestamp: 1 },
  ]);
  const messageTools = stateRef(new Map<number, ToolCallStatus[]>());
  const collapsed = stateRef(new Set<number>());
  const streamingTools = stateRef<ToolCallStatus[]>([]);
  const relay = stateRef<RelayProgress | null>(null);
  const streamingMsgIdx: MutableRefObject<number> = { current: -1 };
  let flushes = 0;
  const handlers = createRelayTurnHandlers({
    segment,
    streamingMsgIdx,
    flushDeltas: () => { flushes++; },
    setMessages: messages.set,
    setMessageTools: messageTools.set,
    setCollapsedSections: collapsed.set,
    setStreamingTools: streamingTools.set,
    setRelay: relay.set,
  });
  return { segment, messages, messageTools, collapsed, streamingTools, relay, streamingMsgIdx, handlers, flushCount: () => flushes };
}

const pm = { id: 'r1', name: '产品经理', color: '#d9730d' };
const arch = { id: 'r2', name: '架构师', color: '#2383e2' };

describe('relay segment lifecycle', () => {
  it('opens an attributed bubble per segment and freezes it on end', () => {
    const h = harness();

    h.handlers.handleRoleTurnStart({ index: 0, total: 2, speakerRole: pm, queue: [pm, arch] });
    expect(h.messages.value).toHaveLength(2);
    expect(h.messages.value[1]).toMatchObject({ role: 'assistant', content: '', speakerRoleName: '产品经理' });
    expect(h.segment.msgIndex).toBe(1);
    expect(h.relay.value).toMatchObject({ speaking: 0, total: 2 });

    // A tool ran during the segment.
    h.segment.tools.push({ id: 1, name: 'canvas_read_node', status: 'running' });
    h.handlers.handleRoleTurnEnd({ index: 0, total: 2, response: '值得做。', runId: 'run-1', speakerRole: pm });

    expect(h.messages.value[1]).toMatchObject({
      content: '值得做。', runId: 'run-1', speakerRoleId: 'r1', speakerRoleColor: '#d9730d',
    });
    expect(h.messages.value[1].toolCalls?.[0]).toMatchObject({ name: 'canvas_read_node', status: 'done' });
    expect(h.messageTools.value.get(1)).toHaveLength(1);
    expect(h.collapsed.value.has(1)).toBe(true);
    // Segment reset: stray deltas can no longer target the frozen bubble.
    expect(h.segment.msgIndex).toBe(-1);
    expect(h.segment.finalized).toBe(1);
    expect(h.relay.value).toMatchObject({ speaking: 1 });

    // Second segment gets its OWN bubble.
    h.handlers.handleRoleTurnStart({ index: 1, total: 2, speakerRole: arch, queue: [pm, arch] });
    expect(h.messages.value).toHaveLength(3);
    expect(h.messages.value[2]).toMatchObject({ speakerRoleName: '架构师', content: '' });
    expect(h.flushCount()).toBeGreaterThanOrEqual(3);
  });

  it('does not surface relay progress for single-speaker turns', () => {
    const h = harness();
    h.handlers.handleRoleTurnStart({ index: 0, total: 1, speakerRole: null, queue: [null] });
    expect(h.relay.value).toBeNull();
    expect(h.messages.value[1].speakerRoleName).toBeUndefined();
  });

  it('surfaces the bar mid-turn when a handoff grows a single-role turn into a relay', () => {
    const h = harness();

    // User @-ed only 产品经理 — no bar while it speaks.
    h.handlers.handleRoleTurnStart({ index: 0, total: 1, speakerRole: pm, queue: [pm] });
    expect(h.relay.value).toBeNull();

    // 产品经理's reply @-ed 架构师 → the end event already announces total=2;
    // the bar stays hidden until the appended speaker actually starts.
    h.handlers.handleRoleTurnEnd({ index: 0, total: 2, response: '@架构师 你看看。', speakerRole: pm });
    expect(h.relay.value).toBeNull();

    const grownQueue = [pm, { ...arch, namedBy: '产品经理' }];
    h.handlers.handleRoleTurnStart({ index: 1, total: 2, speakerRole: arch, queue: grownQueue });
    expect(h.relay.value).toMatchObject({ speaking: 1, total: 2 });
    expect(h.relay.value?.queue[1]).toMatchObject({ id: 'r2', namedBy: '产品经理' });

    h.handlers.handleRoleTurnEnd({ index: 1, total: 2, response: '补充完毕。', speakerRole: arch });
    expect(h.relay.value).toMatchObject({ speaking: 2, total: 2 });
    expect(h.messages.value).toHaveLength(3);
    expect(h.messages.value[2]).toMatchObject({ content: '补充完毕。', speakerRoleName: '架构师' });
  });
});

describe('applyTurnCompletion', () => {
  it('leaves frozen segments untouched on a successful relay', () => {
    const h = harness();
    h.handlers.handleRoleTurnStart({ index: 0, total: 2, speakerRole: pm, queue: [pm, arch] });
    h.handlers.handleRoleTurnEnd({ index: 0, total: 2, response: 'A 段', speakerRole: pm });
    h.handlers.handleRoleTurnStart({ index: 1, total: 2, speakerRole: arch, queue: [pm, arch] });
    h.handlers.handleRoleTurnEnd({ index: 1, total: 2, response: 'B 段', speakerRole: arch });

    const before = h.messages.value.length;
    applyTurnCompletion({
      completeResult: { ok: true, response: 'B 段', runId: 'run-2', speakerRole: arch },
      segment: h.segment,
      setMessages: h.messages.set,
    });
    expect(h.messages.value).toHaveLength(before);
    expect(h.messages.value[1].content).toBe('A 段');
    expect(h.messages.value[2].content).toBe('B 段');
  });

  it('appends an error message when the failure hit between segments', () => {
    const h = harness();
    h.handlers.handleRoleTurnStart({ index: 0, total: 2, speakerRole: pm, queue: [pm, arch] });
    h.handlers.handleRoleTurnEnd({ index: 0, total: 2, response: 'A 段', speakerRole: pm });

    applyTurnCompletion({
      completeResult: { ok: false, error: 'model unavailable' },
      segment: h.segment,
      setMessages: h.messages.set,
    });
    const last = h.messages.value.at(-1)!;
    expect(last.content).toContain('model unavailable');
    expect(h.messages.value[1].content).toBe('A 段');
  });

  it('settles an in-flight bubble with the error and keeps streamed content when present', () => {
    const h = harness();
    h.handlers.handleRoleTurnStart({ index: 0, total: 2, speakerRole: pm, queue: [pm, arch] });
    h.messages.set(prev => {
      const next = [...prev];
      next[1] = { ...next[1], content: '写到一半' };
      return next;
    });
    applyTurnCompletion({
      completeResult: { ok: false, error: 'aborted' },
      segment: h.segment,
      setMessages: h.messages.set,
    });
    expect(h.messages.value[1].content).toBe('写到一半');
    expect(h.messages.value).toHaveLength(2);
  });

  it('falls back to appending the final response when no segment events arrived', () => {
    const h = harness();
    applyTurnCompletion({
      completeResult: { ok: true, response: '普通回复', speakerRole: undefined },
      segment: h.segment,
      setMessages: h.messages.set,
    });
    expect(h.messages.value.at(-1)).toMatchObject({ role: 'assistant', content: '普通回复' });
  });
});
