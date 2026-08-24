import { describe, expect, it } from 'vitest';

import { createTurnContextSnapshot, requestContextFromSnapshot } from './turnContextSnapshot';

describe('turn context snapshots', () => {
  it('captures scope, model, execution policy, and selected context', () => {
    const snapshot = createTurnContextSnapshot(
      { kind: 'workspace', workspaceId: 'ws-1' },
      {
        executionMode: 'ask',
        scope: 'selected_nodes',
        selectedNodes: [{ id: 'n-1', title: 'Roadmap', type: 'text' }],
        tags: [{ name: 'planning' }],
        plugins: [{ id: 'notion', name: 'Notion' }],
        domSelections: [{
          id: 'dom-1',
          label: 'Checkout button',
          nodeId: 'browser-1',
          selector: '#checkout',
        }],
      },
      { modelLabel: 'GPT-5', scopeLabel: 'Product', capturedAt: 42 },
    );

    expect(snapshot).toMatchObject({
      scope: { kind: 'workspace', workspaceId: 'ws-1' },
      scopeLabel: 'Product',
      executionMode: 'ask',
      modelLabel: 'GPT-5',
      capturedAt: 42,
      selectedNodes: [{ id: 'n-1', title: 'Roadmap' }],
      tags: [{ name: 'planning' }],
      plugins: [{ id: 'notion', name: 'Notion' }],
      domSelections: [{ id: 'dom-1', selector: '#checkout' }],
    });
  });

  it('rebuilds regenerate context from the original snapshot', () => {
    const snapshot = createTurnContextSnapshot(
      { kind: 'global' },
      {
        executionMode: 'ask',
        selectedNodes: [{ id: 'n-old', title: 'Original', type: 'text', workspaceId: 'ws-old' }],
        domSelections: [{
          id: 'dom-old',
          label: 'Original element',
          nodeId: 'browser-old',
          selector: '.original',
        }],
        plugins: [{ id: 'exa', name: 'Exa' }],
      },
      { modelLabel: 'Auto', scopeLabel: 'Global', capturedAt: 1 },
    );

    expect(requestContextFromSnapshot(snapshot)).toMatchObject({
      executionMode: 'ask',
      scope: 'selected_nodes',
      selectedNodes: [{ id: 'n-old', workspaceId: 'ws-old' }],
      domSelections: [{ id: 'dom-old', selector: '.original' }],
      plugins: [{ id: 'exa', name: 'Exa' }],
      contextSnapshot: snapshot,
    });
  });
});
