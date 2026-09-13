// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const headerCss = readFileSync(resolve('src/renderer/src/modules/canvas/components/canvas/CanvasNodeView/CanvasNodeHeader/index.css'), 'utf8');
const frameCss = readFileSync(resolve('src/renderer/src/modules/canvas/components/node-bodies/FrameNodeBody/index.css'), 'utf8');

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('frame action toolbar CSS cascade', () => {
  it.each([1, 0.59, 0.25].flatMap(scale => ['selected', 'hover', 'focus'].map(state => ({scale,state}))))('keeps $state frame actions visible at scale $scale', ({scale,state}) => {
    const style = document.createElement('style');
    // happy-dom has no pointer state; classes preserve pseudo-class specificity.
    style.textContent = (headerCss + '\n' + frameCss).replace(/:hover/g, '.test-hover').replace(/:focus-within/g, '.test-focus');
    document.head.append(style);
    document.body.innerHTML = `
      <div class="canvas-transform ${scale < 0.6 ? 'canvas-transform--small' : ''}" style="--canvas-scale:${scale}">
        <div class="canvas-node canvas-node--frame canvas-node--frame-title-overlay ${state === 'selected' ? 'canvas-node--selected' : state === 'hover' ? 'test-hover' : 'test-focus'}">
          <div class="node-header ${state === 'focus' ? 'test-focus' : ''}"><span class="node-title">Coding</span>
            <div class="node-header__actions"><button class="node-focus">Focus</button><button class="node-close">Close</button></div>
          </div>
        </div>
      </div>`;
    const actions = document.querySelector<HTMLElement>('.node-header__actions')!;
    const computed = getComputedStyle(actions);
    expect(computed.display).toBe('flex');
    expect(computed.opacity).toBe('1');
    expect(computed.pointerEvents).toBe('auto');
    // The toolbar is outside the label; a generic right anchor constrains its width.
    expect(computed.left).toBe('100%');
    expect(computed.right || 'auto').toBe('auto');
    expect(computed.transform).toBe('none');
  });

  it.each([false, true])('preserves ordinary small-node popovers (hover=%s)', (hover) => {
    const style = document.createElement('style');
    style.textContent = (headerCss + '\n' + frameCss).replace(/:hover/g, '.test-hover');
    document.head.append(style);
    document.body.innerHTML = `<div class="canvas-transform canvas-transform--small">
      <div class="canvas-node canvas-node--file ${hover ? 'test-hover' : ''}">
        <div class="node-header"><div class="node-header__actions"><button class="node-close">Close</button></div></div>
      </div></div>`;
    const computed = getComputedStyle(document.querySelector('.node-header__actions')!);
    expect(computed.display).toBe(hover ? 'flex' : 'none');
    expect(computed.opacity).toBe(hover ? '1' : '0');
    expect(computed.right).toBe('6px');
  });

});
