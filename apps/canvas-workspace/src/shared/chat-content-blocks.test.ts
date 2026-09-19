import { describe, expect, it } from 'vitest';
import { appendContentText, appendContentTool, contentText, finishContentBlocks, groupContentBlocks } from './chat-content-blocks';
import type { AgentChatContentBlock, AgentChatToolCall } from './agent-chat';

const first: AgentChatToolCall = { id: 1, toolCallId: 'a', name: 'read', status: 'running' };
const second: AgentChatToolCall = { id: 2, toolCallId: 'b', name: 'read', status: 'running' };

describe('ordered public chat content', () => {
  it('merges text deltas without mutating published snapshots', () => {
    const original = appendContentText([], '先');
    expect(appendContentText(original, '检查')).toEqual([{ type: 'text', text: '先检查' }]);
    expect(original).toEqual([{ type: 'text', text: '先' }]);
  });

  it('keeps input-start and tool-call in the same slot', () => {
    const blocks = appendContentTool(appendContentText([], 'inspect'), first);
    expect(appendContentTool(blocks, first)).toBe(blocks);
    expect(appendContentTool(blocks, second)).toHaveLength(3);
  });

  it('groups only adjacent calls and resolves reversed completion by call ID', () => {
    let blocks: AgentChatContentBlock[] = appendContentText([], 'inspect');
    blocks = appendContentTool(blocks, first);
    blocks = appendContentTool(blocks, second);
    blocks = appendContentText(blocks, 'verify');
    blocks = appendContentTool(blocks, { id: 3, toolCallId: 'c' });
    const groups = groupContentBlocks(blocks, [
      { ...second, id: 99, status: 'succeeded' },
      { ...first, status: 'failed' },
      { ...first, id: 3, toolCallId: 'c' },
    ]);
    expect(groups.map(group => group.type)).toEqual(['text', 'tools', 'text', 'tools']);
    expect(groups[1]).toMatchObject({ tools: [{ toolCallId: 'a', status: 'failed' }, { toolCallId: 'b', status: 'succeeded' }] });
    expect(contentText(blocks)).toBe('inspectverify');
  });

  it('does not duplicate final-only response after intermediate commentary', () => {
    const blocks = appendContentText(appendContentTool(appendContentText([], 'inspect'), first), 'done');
    expect(finishContentBlocks(blocks, 'done')).toBe(blocks);
    expect(finishContentBlocks(blocks, 'inspectdone')).toBe(blocks);
  });

  it('supports text returned without deltas and JSON round trips', () => {
    const blocks = finishContentBlocks(appendContentTool([], first), 'done');
    expect(JSON.parse(JSON.stringify(blocks))).toEqual([
      { type: 'tool', toolId: 1, toolCallId: 'a' },
      { type: 'text', text: 'done' },
    ]);
  });
});
