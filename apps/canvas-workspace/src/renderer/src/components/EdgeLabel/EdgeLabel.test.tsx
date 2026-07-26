import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CanvasEdge, CanvasNode } from '../../types';
import { EdgeLabel } from '.';

describe('EdgeLabel', () => {
  it('sits on the visual midpoint of an automatically routed curve', () => {
    const nodes: CanvasNode[] = [
      {
        id: 'source',
        type: 'text',
        title: 'Source',
        x: 0,
        y: 0,
        width: 100,
        height: 60,
        data: { text: 'source' },
      } as CanvasNode,
      {
        id: 'target',
        type: 'text',
        title: 'Target',
        x: 146,
        y: 102,
        width: 100,
        height: 60,
        data: { text: 'target' },
      } as CanvasNode,
    ];
    const edge: CanvasEdge = {
      id: 'curved',
      source: { kind: 'node', nodeId: 'source', anchor: 'right' },
      target: { kind: 'node', nodeId: 'target', anchor: 'top' },
      label: 'relationship',
    };

    const html = renderToStaticMarkup(
      <EdgeLabel
        edge={edge}
        nodes={nodes}
        transform={{ x: 0, y: 0, scale: 1 }}
        isEditing={false}
        onStartEdit={vi.fn()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(html).toContain('left:159.85px;top:49.95px');
  });
});
