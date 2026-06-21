import { describe, expect, it } from 'vitest';
import type { ToolCallStatus } from '../types';
import { markToolResult, settleRunningTools, upsertToolInputStart } from './toolStreamState';

describe('toolStreamState', () => {
  it('deduplicates repeated tool-input starts by toolCallId', () => {
    let nextId = 0;
    const tools: ToolCallStatus[] = [];

    upsertToolInputStart(tools, { id: 'call-1', toolName: 'tavily' }, () => ++nextId);
    upsertToolInputStart(tools, { id: 'call-1', toolName: 'tavily' }, () => ++nextId);

    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      id: 1,
      name: 'tavily',
      toolCallId: 'call-1',
      status: 'running',
      inputStreaming: true,
    });
  });

  it('does not revive a completed tool when a late duplicate start arrives', () => {
    const tools: ToolCallStatus[] = [{
      id: 1,
      name: 'tavily',
      toolCallId: 'call-1',
      status: 'done',
      inputStreaming: false,
    }];

    upsertToolInputStart(tools, { id: 'call-1', toolName: 'tavily' }, () => 2);

    expect(tools).toHaveLength(1);
    expect(tools[0].status).toBe('done');
    expect(tools[0].inputStreaming).toBe(false);
  });

  it('marks the oldest running same-name tool done when result ids do not line up', () => {
    const tools: ToolCallStatus[] = [
      { id: 1, name: 'tavily', toolCallId: 'call-a', status: 'running' },
      { id: 2, name: 'tavily', toolCallId: 'call-b', status: 'running' },
    ];

    markToolResult(tools, { name: 'tavily', toolCallId: 'missing-id', result: 'ok' });

    expect(tools[0]).toMatchObject({ status: 'done', result: 'ok', inputStreaming: false });
    expect(tools[1].status).toBe('running');
  });

  it('settles any remaining running tools when the turn completes', () => {
    const tools: ToolCallStatus[] = [
      { id: 1, name: 'tavily', status: 'running' },
      { id: 2, name: 'visual_render', status: 'running', streamedContent: '<html></html>' },
    ];

    settleRunningTools(tools);

    expect(tools.every(tool => tool.status === 'done')).toBe(true);
    expect(tools[1].streamedDone).toBe(true);
  });
});
