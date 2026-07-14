import { describe, expect, it } from 'vitest';

import { formatSelectionFocusBlock } from '../selection-focus-context';

describe('global knowledge selection prompt', () => {
  it('reads an exact selected node through the knowledge library without rediscovery', () => {
    const prompt = formatSelectionFocusBlock([
      { id: 'img-1', title: 'Architecture screenshot', type: 'image', workspaceId: 'internal-ws' },
    ], { requireWorkspaceId: true });

    expect(prompt).toContain('knowledge_read_node');
    expect(prompt).toContain('exact `nodeId`');
    expect(prompt).toContain('Do not search again, list workspaces, read the whole canvas');
    expect(prompt).not.toContain('call `canvas_read_node`');
  });
});
