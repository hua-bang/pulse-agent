import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./browser', () => ({ openPageRunBrowser: vi.fn() }));
vi.mock('./text', () => ({ generateFieldText: vi.fn() }));
import { approvePageAction, createPageRunTool } from './tool';
import type { PageAction } from './types';

const action: PageAction = {
  id: 'fill_e1', kind: 'fill', description: 'Fill query',
  target: { ref: 'e1', name: 'Query', role: 'textbox', value: '', checked: null, expanded: null, operations: ['fill'] },
};
afterEach(() => { vi.unstubAllEnvs(); });

describe('page_run host boundary', () => {
  it('does not open a page or make requests without a key', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', '');
    const open = vi.fn();
    const result = JSON.parse(await createPageRunTool('ws', { open, decision: vi.fn(), text: vi.fn() }).execute({ nodeId: 'link:1', goal: 'Read' }));
    expect(result.reason).toContain('TYPESAFE_API_KEY');
    expect(open).not.toHaveBeenCalled();
  });

  it('routes read mode through the controller and returns a consumable versioned result', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', 'test-key');
    const close = vi.fn();
    const execute = vi.fn();
    const open = vi.fn().mockResolvedValue({
      observe: async () => ({ id: 's', documentId: 'd', url: 'https://example.test', title: 'Small article',
        text: 'Whole visible article', fingerprint: 'f', targets: [], scrollUp: false, scrollDown: false, truncated: false }),
      isFresh: async () => true, execute, close,
    });
    const decision = vi.fn().mockReturnValue(async () => ({ action: 'scroll_down', confidence: 1,
      goalDone: 0, stuck: 0, model: 'fixture', inputTokens: 1, outputTokens: 1 }));
    const output = JSON.parse(await createPageRunTool('ws', { open, decision, text: vi.fn() })
      .execute({ nodeId: 'link:1', goal: 'Read all', mode: 'read' }));
    expect(output).toMatchObject({ formatVersion: 2, status: 'read_complete', usage: { jevCalls: 1 }, reading: { inlineComplete: true } });
    expect(execute).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it('asks for a concrete child action even with an outer approval receipt', async () => {
    const approve = vi.fn().mockResolvedValue('No');
    expect(await approvePageAction('link:1', action, 'Pulse', 2, {
      toolCallId: 'outer', runContext: { executionMode: 'ask', approvalGrantedFor: 'outer' },
      onClarificationRequest: approve,
    }, new AbortController().signal)).toBe(false);
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({
      id: 'tool-approval:outer:step:2', kind: 'approval', context: expect.stringContaining('Pulse'),
    }));
  });

  it('keeps Auto mode behavior and rejects cancellation after an Allow response', async () => {
    const approve = vi.fn();
    expect(await approvePageAction('link:1', action, 'Pulse', 1, {
      runContext: { executionMode: 'auto' }, onClarificationRequest: approve,
    }, new AbortController().signal)).toBe(true);
    expect(approve).not.toHaveBeenCalled();
    const controller = new AbortController();
    await expect(approvePageAction('link:1', action, 'Pulse', 1, {
      runContext: { executionMode: 'ask' }, onClarificationRequest: async () => {
        controller.abort(new Error('Cancelled')); return 'Yes';
      },
    }, controller.signal)).rejects.toThrow('Cancelled');
  });
});
