import { describe, expect, it } from 'vitest';

import { createCanvasAgentToolPolicy } from '../tool-policy';

describe('Canvas Agent tool policy', () => {
  it('gives global chat only reviewed read-only built-ins and canvas readers', () => {
    const policy = createCanvasAgentToolPolicy({ kind: 'global' });
    const finalNames = Object.keys({
      ...policy.builtInTools,
      ...policy.canvasTools,
    }).sort();

    expect(Object.keys(policy.builtInTools ?? {}).sort()).toEqual([
      'clarify',
      'grep',
      'ls',
      'read',
      'tavily',
      'tavily_crawl',
      'tavily_extract',
      'tavily_map',
    ]);
    expect(finalNames).not.toContain('canvas_propose_node_change');
    expect(finalNames).toContain('knowledge_search_nodes');
    expect(finalNames).toContain('knowledge_read_node');
    expect(finalNames).toContain('knowledge_analyze_image');
    expect(finalNames).not.toContain('bash');
    expect(finalNames).not.toContain('edit');
    expect(finalNames).not.toContain('generate_image');
    expect(finalNames).not.toContain('write');
    expect(finalNames).not.toContain('canvas_tag_node');
  });

  it('keeps the full engine built-ins and direct canvas tools in workspace chat', () => {
    const policy = createCanvasAgentToolPolicy({ kind: 'workspace', workspaceId: 'ws-1' });

    expect(policy.builtInTools).toBeUndefined();
    expect(policy.canvasTools.canvas_tag_node).toBeDefined();
    expect(policy.canvasTools.canvas_create_terminal_node).toBeDefined();
  });
});
