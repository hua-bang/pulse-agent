import { describe, expect, it } from 'vitest';
import {
  shouldRenderEdgeLabels,
  shouldRenderEdgeStylePanel,
} from './CanvasOverlays';

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
});
