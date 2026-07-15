// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { recordJankSample } from './jank-monitor';

describe('window.__pulseJank load-state recorder', () => {
  afterEach(() => {
    delete window.__pulseJank;
    document.body.innerHTML = '';
  });

  it('tags samples with canvas scale and logical node count', () => {
    document.body.innerHTML = `
      <div class="canvas-transform" style="--canvas-scale: 0.25">
        <div class="canvas-node canvas-node--frame canvas-node--frame-body-layer"></div>
        <div class="canvas-node canvas-node--frame canvas-node--frame-title-overlay"></div>
        <div class="canvas-node canvas-node--text"></div>
      </div>`;

    const sample = recordJankSample(120, 80);

    expect(sample.durMs).toBe(120);
    expect(sample.blockingMs).toBe(80);
    expect(sample.scale).toBe(0.25);
    // 3 .canvas-node elements minus the frame title overlay = 2 logical nodes.
    expect(sample.canvasNodes).toBe(2);
    expect(window.__pulseJank).toHaveLength(1);
  });

  it('reports null scale off-canvas and enforces the ring-buffer cap', () => {
    const first = recordJankSample(60, 55);
    expect(first.scale).toBeNull();
    expect(first.visibleEmbeds).toBe(0);

    for (let i = 0; i < 220; i++) recordJankSample(60, 55);
    expect(window.__pulseJank?.length).toBe(200);
  });
});
