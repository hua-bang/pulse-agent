import { describe, expect, it } from 'vitest';

import type { WorkspaceSummary } from '../types';
import { buildGlobalTurnContext, buildWorkspaceTurnContext, withTurnContext } from './turn-context';

const summary: WorkspaceSummary = {
  workspaceId: 'ws-1',
  workspaceName: 'Research board',
  canvasDir: '/tmp/ws-1',
  nodeCount: 1,
  nodes: [{ id: 'node-1', type: 'file', title: 'Market notes' }],
};

describe('Canvas Agent turn context', () => {
  it('puts the selection before the canvas summary, then mentions', () => {
    const context = buildWorkspaceTurnContext(
      summary,
      [{ id: 'ws-2', name: 'Other board' }],
      { selectedNodes: [{ id: 'node-1', title: 'Market notes', type: 'file' }] },
      'ws-1',
    );

    const focus = context.indexOf('## Current Focus');
    const canvas = context.indexOf('## Current Canvas');
    const mentions = context.indexOf('Other board');
    expect(focus).toBeGreaterThanOrEqual(0);
    expect(canvas).toBeGreaterThan(focus);
    expect(mentions).toBeGreaterThan(canvas);
    expect(context).toContain('[node-1] **Market notes**');
  });

  it('marks an empty workspace instead of omitting the canvas section', () => {
    expect(buildWorkspaceTurnContext(null, [], undefined, 'ws-1'))
      .toContain('(empty workspace — no nodes yet)');
  });

  it('wraps the context ahead of the user text and skips an empty block', () => {
    expect(withTurnContext('hello', '   ')).toBe('hello');
    expect(buildGlobalTurnContext([], undefined)).toBe('');

    const wrapped = withTurnContext('hello', '\n## Current Canvas\nnodes\n');
    expect(wrapped.startsWith('<turn_context>\n')).toBe(true);
    expect(wrapped).toContain('The user did not write it.');
    expect(wrapped.endsWith('</turn_context>\n\nhello')).toBe(true);
  });
});
