import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const renderer = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../src/renderer/src');
const css = [
  'modules/canvas/components/canvas/CanvasNodeView/index.css',
  'modules/canvas/components/canvas/CanvasNodeView/CanvasNodeBody/index.css',
  'modules/canvas/components/node-bodies/FileNodeBody/index.css',
  'components/ui/Button/index.css',
  'modules/note-editor/components/NoteBlockHandle/index.css',
].map(file => readFileSync(resolve(renderer, file), 'utf8')).join('\n');

// Real styles + the FileNodeBody ancestor chain: measure total rendered insets,
// not a padding literal (which misses wrapper padding and centered columns).
for (const scale of [0.5, 1, 1.5]) {
  for (const [width, mode] of [[320, ''], [520, ''], [900, ''], [1200, 'canvas-node--focus-mode-focused'], [700, 'canvas-node--fullscreen']] as const) {
    test(`balanced note column: ${width}px ${mode || 'card'} at ${scale}`, async ({ page }) => {
      await page.setContent(`<style>:root { --accent-border: blue; }${css}</style>
        <div style="position:relative;width:${width + 24}px;height:524px;transform:scale(${scale});transform-origin:top left">
          <div class="canvas-node canvas-node--file ${mode}" style="width:${width}px;height:500px">
            <div class="node-body"><div class="note-card"><div class="note-content"><div class="note-tiptap-editor">
              <div class="ProseMirror"><h2>中文阅读标题</h2><p>Compact document with a comfortable reading column.</p></div>
            </div></div>
              <span class="note-block-handle-anchor">
                <button class="ui-btn ui-btn--icon ui-btn--xs note-block-handle">⋮</button>
              </span>
            </div></div>
          </div>
        </div>`);
      const geometry = await page.evaluate(() => {
        const card = document.querySelector<HTMLElement>('.canvas-node')!;
        const editor = document.querySelector<HTMLElement>('.ProseMirror')!;
        const block = editor.firstElementChild!;
        const c = card.getBoundingClientRect(), b = block.getBoundingClientRect();
        const zoom = c.width / card.offsetWidth;
        return {
          left: (b.left - c.left) / zoom,
          right: (c.right - b.right) / zoom,
          editorWidth: editor.getBoundingClientRect().width / zoom,
          overflow: editor.scrollWidth - editor.clientWidth,
        };
      });
      expect(Math.abs(geometry.left - geometry.right)).toBeLessThanOrEqual(2);
      if (width <= 520) expect(geometry.left).toBeLessThanOrEqual(30);
      expect(geometry.editorWidth).toBeLessThanOrEqual(800);
      expect(geometry.overflow).toBe(0);
      // The component tests cover dynamic anchoring/drop geometry. Here the
      // same 26px offset exercises the single handle's bounds and focus ring.
      const controls = await page.evaluate(() => {
        const card = document.querySelector<HTMLElement>('.note-card')!;
        const block = document.querySelector('.ProseMirror')!.firstElementChild!;
        const c = card.getBoundingClientRect(), b = block.getBoundingClientRect();
        const zoom = c.width / card.offsetWidth;
        const anchor = document.querySelector<HTMLElement>('.note-block-handle-anchor')!;
        anchor.style.left = `${(b.left - c.left) / zoom - 26}px`;
        anchor.style.top = `${(b.top - c.top) / zoom}px`;
        const a = anchor.getBoundingClientRect();
        return [...anchor.querySelectorAll('button')].map(button => {
          button.focus();
          const r = button.getBoundingClientRect();
          const style = getComputedStyle(button);
          const ring = Math.max(0, parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset));
          return {
            width: r.width / zoom,
            height: r.height / zoom,
            anchorWidth: a.width / zoom,
            anchorHeight: a.height / zoom,
            top: (r.top - b.top) / zoom,
            gap: (b.left - r.right) / zoom - ring,
            left: (r.left - c.left) / zoom - ring,
            reachable: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') === button,
          };
        });
      });
      expect(controls).toHaveLength(1);
      for (const control of controls) {
        expect(control.width).toBeCloseTo(22, 1);
        expect(control.height).toBeCloseTo(22, 1);
        expect(control.anchorWidth).toBeCloseTo(22, 1);
        expect(control.anchorHeight).toBeCloseTo(22, 1);
        expect(control.top).toBeCloseTo(1, 1);
        expect(control.gap).toBeGreaterThanOrEqual(1.9);
        expect(control.left).toBeGreaterThanOrEqual(-0.1);
        expect(control.reachable).toBe(true);
      }
    });
  }
}
