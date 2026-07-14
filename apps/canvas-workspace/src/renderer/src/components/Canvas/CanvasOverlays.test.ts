import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CanvasEdge } from '../../types';
import type { EdgeInteractionState } from '../../hooks/useEdgeInteraction';
import {
  projectEdgeOverlayGeometry,
  shouldRenderEdgeLabels,
  shouldRenderEdgeStylePanel,
} from './CanvasOverlays';

const canvasCss = readFileSync(new URL('./index.css', import.meta.url), 'utf8');

describe('CanvasOverlays movement gating', () => {
  it('parks edge labels during pan and zoom gestures', () => {
    expect(shouldRenderEdgeLabels({ moving: true, editingEdgeLabelId: null })).toBe(false);
  });

  it('keeps an actively edited edge label mounted during movement', () => {
    expect(shouldRenderEdgeLabels({ moving: true, editingEdgeLabelId: 'edge-1' })).toBe(true);
  });

  it('renders edge labels when the viewport is idle', () => {
    expect(shouldRenderEdgeLabels({ moving: false, editingEdgeLabelId: null })).toBe(true);
  });

  it('parks the edge style panel during movement', () => {
    expect(shouldRenderEdgeStylePanel(true)).toBe(false);
    expect(shouldRenderEdgeStylePanel(false)).toBe(true);
  });

  it('keeps the bottom floating toolbar visible during movement', () => {
    expect(canvasCss).not.toContain('.canvas-container[data-moving="on"] .floating-toolbar');
  });

  it('does not promote the entire canvas subtree when a gesture starts', () => {
    expect(canvasCss).not.toMatch(
      /\.canvas-transform--moving\s*\{[^}]*will-change\s*:\s*transform/i,
    );
  });

  it('keeps Electron webview hosts fully painted during canvas motion', () => {
    expect(canvasCss).not.toMatch(
      /\.canvas-transform--moving[^{}]*\.iframe-frame-host[^{}]*\{[^}]*visibility\s*:\s*hidden/i,
    );
  });

  it('bounds the wheel-motion shield to the canvas below Canvas chrome', () => {
    expect(canvasCss).toMatch(
      /\.canvas-interaction-shield--canvas-motion\s*\{[^}]*position\s*:\s*absolute[^}]*z-index\s*:\s*calc\(var\(--layer-canvas-chrome\)\s*-\s*1\)/i,
    );
  });
});

describe('CanvasOverlays edge drag projection', () => {
  const edge: CanvasEdge = {
    id: 'edge-1',
    source: { kind: 'point', x: 0, y: 0 },
    target: { kind: 'point', x: 100, y: 50 },
    bend: 0,
    label: 'flow',
  };
  const interactionState: EdgeInteractionState = {
    kind: 'move-edge',
    edgeId: edge.id,
    initialSource: edge.source,
    initialTarget: edge.target,
    originCursor: { x: 10, y: 10 },
    cursor: { x: 35, y: 45 },
    previewPatch: {
      source: { kind: 'point', x: 25, y: 35 },
      target: { kind: 'point', x: 125, y: 85 },
    },
  };

  it('feeds one ephemeral edge object to both labels and the style panel', () => {
    const projected = projectEdgeOverlayGeometry([edge], edge, interactionState);

    expect(projected.edges?.[0]).toEqual({
      ...edge,
      source: { kind: 'point', x: 25, y: 35 },
      target: { kind: 'point', x: 125, y: 85 },
    });
    expect(projected.selectedEdge).toBe(projected.edges?.[0]);
    expect(edge).toMatchObject({
      source: { kind: 'point', x: 0, y: 0 },
      target: { kind: 'point', x: 100, y: 50 },
    });
  });

  it('preserves canonical identities when no preview geometry is active', () => {
    const projected = projectEdgeOverlayGeometry([edge], edge, null);

    expect(projected.edges?.[0]).toBe(edge);
    expect(projected.selectedEdge).toBe(edge);
  });
});
