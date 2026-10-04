import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// The read-only dock canvas renders the shared bottom chrome without the
// floating toolbar. Its row must stay as tall as the toolbar, or the zoom
// chrome moves vertically when the same tab enters Edit mode.
const read = (path: string) => readFileSync(`src/renderer/src/modules/canvas/components/canvas/${path}`, 'utf8');
const px = (css: string, selector: string, property: string) => {
  const block = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`))?.[1] ?? '';
  const value = block.match(new RegExp(`\\n\\s*${property}:\\s*(\\d+)px`))?.[1];
  expect(value, `${selector} ${property}`).toBeDefined();
  return Number(value);
};

it('reserves the floating toolbar row height in the bottom chrome', () => {
  const toolbar = read('FloatingToolbar/index.css');
  const toolbarRow = px(toolbar, '.toolbar-btn', 'height')
    + 2 * px(toolbar, '.floating-toolbar', 'padding')
    + 2 * Number(toolbar.match(/(?:^|\n)\.floating-toolbar \{[^}]*\n\s*border:\s*(\d+)px/)?.[1]);
  expect(px(read('Canvas/index.css'), '.canvas-bottom-chrome', 'min-height')).toBe(toolbarRow);
});
