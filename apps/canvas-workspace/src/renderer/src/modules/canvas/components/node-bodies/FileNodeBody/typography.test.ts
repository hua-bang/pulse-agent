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

  it('shows a board note as a reading card and keeps the toolbar header for fullscreen', () => {
    const card = '.canvas-node--file:not(.canvas-node--fullscreen)';
    const header = nodeBodyCss.slice(nodeBodyCss.indexOf(`${card}>.node-header {`));
    expect(header).toContain('padding: 28px 32px 0');
    expect(header).toContain('background: transparent');
    expect(nodeBodyCss).toContain(`${card}:not(:hover):not(.canvas-node--selected)>.node-header .node-header__actions {\n  display: none;`);
    const title = rule(`${card}>.node-header .node-title`);
    expect(title).toContain('font-size: 22px');
    expect(title).toContain('-webkit-line-clamp: 3');
    expect(rule(`${card} .note-tiptap-editor .ProseMirror`)).toContain('padding: 12px 32px 32px');
    expect(css).toContain('.canvas-node--title-in-body:not(.canvas-node--fullscreen) .note-tiptap-editor :is(.ProseMirror, .note-markdown-preview)>h1:first-child {\n  display: none;');
    // Fullscreen and other nodes keep the shared header geometry.
    expect(headerCss).toContain('min-height: 32px');
    expect(headerCss).toContain('font-size: 13px');
    expect(headerCss).toContain('text-overflow: ellipsis');
    expect(headerCss).toContain('.node-type-badge--file');
  });
});
