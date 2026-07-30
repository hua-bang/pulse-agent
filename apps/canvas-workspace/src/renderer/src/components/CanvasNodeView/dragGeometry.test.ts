import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const canvasNodeCss = readFileSync(
  fileURLToPath(new URL('./index.css', import.meta.url)),
  'utf8',
);
const textNodeCss = readFileSync(
  fileURLToPath(new URL('../TextNodeBody/index.css', import.meta.url)),
  'utf8',
);

const ruleBody = (css: string, selector: string): string => {
  const start = css.indexOf(`${selector} {`);
  expect(start, `Missing CSS rule: ${selector}`).toBeGreaterThanOrEqual(0);
  const bodyStart = css.indexOf('{', start) + 1;
  const bodyEnd = css.indexOf('}', bodyStart);
  return css.slice(bodyStart, bodyEnd);
};

const expectGeometryInvariant = (body: string): void => {
  expect(body).not.toMatch(/\b(?:scale|translate|rotate|transform|animation)\s*:/);
};

describe('content-node drag geometry', () => {
  it('keeps Note, Text, and Web wrapper geometry invariant on hover', () => {
    expectGeometryInvariant(ruleBody(
      canvasNodeCss,
      '.canvas-node.canvas-node--file:not(.canvas-node--dragging):not(.canvas-node--resizing):hover',
    ));
    expectGeometryInvariant(ruleBody(
      canvasNodeCss,
      '.canvas-node--iframe:not(.canvas-node--dragging):not(.canvas-node--resizing):hover',
    ));
    expectGeometryInvariant(ruleBody(
      textNodeCss,
      '.canvas-node--text:not(.canvas-node--dragging):not(.canvas-node--resizing):hover',
    ));
  });

  it('restores exact wrapper geometry while dragging', () => {
    const draggingBody = ruleBody(
      canvasNodeCss,
      [
        '.canvas-node--file.canvas-node--dragging,',
        '.canvas-node--iframe.canvas-node--dragging,',
        '.canvas-node--text.canvas-node--dragging',
      ].join('\n'),
    );
    expectGeometryInvariant(draggingBody);
  });
});
