import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8');
const nodeBodyCss = readFileSync(new URL('../../canvas/CanvasNodeView/CanvasNodeBody/index.css', import.meta.url), 'utf8');
const headerCss = readFileSync(new URL('../../canvas/CanvasNodeView/CanvasNodeHeader/index.css', import.meta.url), 'utf8');
const rule = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
};

describe('rich text presentation contract', () => {
  it('keeps document fonts and compact defaults local to the editor', () => {
    const body = rule('.note-tiptap-editor .ProseMirror');
    expect(body).toContain("'PingFang SC'");
    expect(body).not.toContain('var(--font-ui)');
    expect(body).toContain('font-size: 15px');
    expect(body).toContain('--note-heading-1: 1.5em');
    expect(body).toContain('padding: 20px 28px 72px');
    expect(body).toContain('overflow-wrap: anywhere');
  });

  it('uses existing focus states for comfortable reading, without width-only heading inflation', () => {
    expect(css).toContain('@container (min-width: 561px)');
    const focus = rule(':is(.canvas-node--focus-mode-focused, .canvas-node--fullscreen) .note-tiptap-editor .ProseMirror');
    expect(focus).toContain('font-size: 16px');
    expect(focus).toContain('line-height: 1.8');
    expect(focus).toContain('--note-heading-1: 1.75em');
    expect(rule('.note-tiptap-editor .ProseMirror h1')).toContain('var(--note-heading-1)');
    expect(rule('.note-tiptap-editor .ProseMirror li :is(ul, ol)')).toContain('margin-block: 0.25em');
  });

  it('keeps inline code neutral while preserving separate code-block styling', () => {
    const inline = rule('.note-tiptap-editor .ProseMirror code');
    expect(inline).toContain('var(--text-secondary)');
    expect(inline).not.toContain('var(--error)');
    expect(inline).toContain('padding: 0.08em 0.25em');
    expect(rule('.note-tiptap-editor .ProseMirror pre code')).toContain('background: none');
  });

  it('inherits shared node header geometry, title truncation, icon and action states', () => {
    expect(nodeBodyCss).not.toMatch(/\.canvas-node--file[^{}]*\.node-header/);
    expect(headerCss).toContain('min-height: 32px');
    expect(headerCss).toContain('font-size: 13px');
    expect(headerCss).toContain('text-overflow: ellipsis');
    expect(headerCss).toContain('.node-type-badge--file');
  });
});
