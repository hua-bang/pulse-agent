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

  it.each([false, true])('keeps an @-mentioned App focused on content rather than reopening it (global=%s)', (global) => {
    const prompt = formatSelectionFocusBlock([
      { id: 'app-node', title: 'Bits & Bolts', type: 'plugin', workspaceId: 'ws-1' },
    ], { requireWorkspaceId: global });

    expect(prompt).toContain('selected or @-mentioned');
    expect(prompt).toContain('CONTENT is the PRIMARY context');
    expect(prompt).toContain('nodeId: `app-node`');
    expect(prompt).toContain('live visible-ui and model-context');
    expect(prompt).toContain('If it answers the question, stop gathering data');
    expect(prompt).toContain('Do not call an App entrypoint/library/display tool merely to summarize');
    expect(prompt).toContain('Open an App only when the user explicitly requests');
    expect(prompt).toContain('coordinates only when the user explicitly asks');
  });

  it('does not impose selected-node rules on a turn without node references', () => {
    expect(formatSelectionFocusBlock([], { requireWorkspaceId: false })).toBe('');
  });
});
