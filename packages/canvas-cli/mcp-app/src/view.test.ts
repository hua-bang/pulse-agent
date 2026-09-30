import { describe, it, expect } from 'vitest';
import {
  arrowPoints,
  borderPoint,
  containedIds,
  edgeGeometry,
  fitTransform,
  MAX_SCALE,
  MIN_NODE_WIDTH,
  resizedRect,
  screenToWorld,
  zoomAt,
} from './geometry';
import { escapeHtml, renderMarkdown } from './markdown';
import { coalesceOperations, newViewId } from './operations';
import { describeViewForModel } from './model-context';
import type { CanvasSnapshot } from '../../src/mcp/view-types';

describe('geometry', () => {
  it('zooms around the anchor point', () => {
    const next = zoomAt({ x: 10, y: 20, scale: 1 }, 2, { x: 110, y: 120 });
    expect(screenToWorld(next, { x: 110, y: 120 })).toEqual({ x: 100, y: 100 });
    expect(zoomAt({ x: 0, y: 0, scale: 2.8 }, 10, { x: 0, y: 0 }).scale).toBe(MAX_SCALE);
  });

  it('fits content without zooming in past 100%', () => {
    const fit = fitTransform([{ x: 0, y: 0, width: 100, height: 100 }], { width: 1000, height: 800 });
    expect(fit.scale).toBe(1);
    expect(fit).toMatchObject({ x: 450, y: 350 });
    const wide = fitTransform([{ x: -500, y: 0, width: 3000, height: 200 }], { width: 1000, height: 800 }, 50);
    expect(wide.scale).toBeCloseTo(0.3);
  });

  it('routes edges from border to border', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 };
    const b = { x: 300, y: 0, width: 100, height: 100 };
    expect(borderPoint(a, { x: 350, y: 50 })).toEqual({ x: 100, y: 50 });
    expect(edgeGeometry(a, b)).toEqual({ from: { x: 100, y: 50 }, to: { x: 300, y: 50 }, mid: { x: 200, y: 50 } });
    expect(edgeGeometry({ x: 5, y: 5 }, b).from).toEqual({ x: 5, y: 5 });
    expect(arrowPoints({ x: 0, y: 0 }, { x: 10, y: 0 }, 5).split(' ')[0]).toBe('10.0,0.0');
  });

  it('finds nodes carried by a frame by center containment', () => {
    const frame = { id: 'f', x: 0, y: 0, width: 400, height: 300 };
    const ids = containedIds(frame, [
      frame,
      { id: 'in', x: 10, y: 10, width: 100, height: 100 },
      { id: 'edge', x: 350, y: 250, width: 200, height: 200 },
    ]);
    expect(ids).toEqual(['in']);
  });

  it('clamps resizes to the minimum size', () => {
    expect(resizedRect({ x: 0, y: 0, width: 100, height: 100 }, -500, 20)).toMatchObject({ width: MIN_NODE_WIDTH, height: 120 });
  });
});

describe('markdown', () => {
  it('escapes before adding markup', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)> **bold** `<b>`');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>&lt;b&gt;</code>');
  });

  it('keeps only http(s) links and routes them through data-href', () => {
    expect(renderMarkdown('[ok](https://example.com/a?b=1&c=2)')).toContain('<a data-href="https://example.com/a?b=1&amp;c=2">ok</a>');
    expect(renderMarkdown('[bad](javascript:alert(1))')).not.toContain('<a');
    expect(renderMarkdown('[q](https://x.test/"onmouseover=")')).not.toContain('"onmouseover');
  });

  it('renders headings, lists, tasks, quotes, and code blocks', () => {
    const html = renderMarkdown('# Title\n- a\n- [x] done\n1. one\n> quote\n```\n<x>\n```\ntext');
    expect(html).toContain('<h3>Title</h3>');
    expect(html).toContain('<ul><li>a</li><li>☑ done</li></ul>');
    expect(html).toContain('<ol><li>one</li></ol>');
    expect(html).toContain('<blockquote>quote</blockquote>');
    expect(html).toContain('<pre><code>&lt;x&gt;</code></pre>');
    expect(html).toContain('<p>text</p>');
    expect(escapeHtml(`"'`)).toBe('&quot;&#39;');
  });
});

describe('coalesceOperations', () => {
  it('merges repeated updates and folds updates into creates', () => {
    expect(coalesceOperations([
      { action: 'create', type: 'file', id: 'n', x: 0, y: 0, content: '' },
      { action: 'update', id: 'n', content: 'hi' },
      { action: 'update', id: 'm', x: 1, y: 1 },
      { action: 'update', id: 'm', x: 5, y: 6 },
      { action: 'update', id: 'm', width: 300 },
    ])).toEqual([
      { action: 'create', type: 'file', id: 'n', x: 0, y: 0, content: 'hi' },
      { action: 'update', id: 'm', x: 5, y: 6, width: 300 },
    ]);
  });

  it('keeps a frame label patch as its own update after the create', () => {
    const label = JSON.stringify({ label: 'Renamed' });
    expect(coalesceOperations([
      { action: 'create', type: 'frame', id: 'f', x: 0, y: 0, data: { label: 'Frame' } },
      { action: 'update', id: 'f', x: 10 },
      { action: 'update', id: 'f', content: label },
    ])).toEqual([
      { action: 'create', type: 'frame', id: 'f', x: 10, y: 0, data: { label: 'Frame' } },
      { action: 'update', id: 'f', content: label },
    ]);
  });

  it('drops a node created and deleted in one batch together with its edges', () => {
    expect(coalesceOperations([
      { action: 'create', type: 'file', id: 'n', x: 0, y: 0 },
      { action: 'createEdge', id: 'e', from: 'a', to: 'n' },
      { action: 'delete', id: 'n' },
      { action: 'update', id: 'a', x: 2 },
      { action: 'delete', id: 'a' },
    ])).toEqual([{ action: 'delete', id: 'a' }]);
  });

  it('cancels an edge created and deleted before flushing', () => {
    expect(coalesceOperations([
      { action: 'createEdge', id: 'e', from: 'a', to: 'b' },
      { action: 'deleteEdge', id: 'e' },
      { action: 'deleteEdge', id: 'old' },
    ])).toEqual([{ action: 'deleteEdge', id: 'old' }]);
  });

  it('mints store-safe ids', () => {
    expect(newViewId('node')).toMatch(/^node-[A-Za-z0-9_.-]+$/);
  });
});

describe('describeViewForModel', () => {
  const snapshot: CanvasSnapshot = {
    workspaceId: 'ws',
    workspaceName: 'Research',
    version: 'v',
    revision: null,
    edges: [],
    nodes: [
      { id: 'a', type: 'file', title: 'Plan', x: 0, y: 0, width: 1, height: 1, editable: 'content', content: 'Line one\nline two' },
      { id: 'b', type: 'frame', title: 'Frame', x: 0, y: 0, width: 1, height: 1, editable: 'label', label: 'Q3' },
    ],
  };

  it('lists the selection with ids and excerpts', () => {
    const text = describeViewForModel(snapshot, ['a', 'b', 'missing']);
    expect(text).toContain('workspace "Research" (workspaceId: ws, 2 nodes, 0 edges)');
    expect(text).toContain('- [file] "Plan" (id: a): Line one line two');
    expect(text).toContain('- [frame] "Frame" (id: b): Q3');
  });

  it('says when nothing is selected', () => {
    expect(describeViewForModel(snapshot, [])).toContain('No nodes are selected.');
  });
});
