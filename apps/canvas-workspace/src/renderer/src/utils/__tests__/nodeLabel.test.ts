import { describe, expect, it } from 'vitest';
import type { CanvasNode } from '../../types';
import { getNodeDisplayLabel } from '../nodeLabel';

const textNode = (content: string, title = ''): CanvasNode => ({
  id: 'n1',
  type: 'text',
  title,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  data: { content },
} as unknown as CanvasNode);

describe('getNodeDisplayLabel — text nodes', () => {
  it('strips HTML tags from Tiptap content (no markup leaks into the label)', () => {
    const label = getNodeDisplayLabel(textNode('<p>如何理解 Harness Engineering</p>'));
    expect(label).not.toContain('<');
    expect(label.startsWith('如何理解')).toBe(true);
  });

  it('strips a leading inline tag like <strong>', () => {
    const label = getNodeDisplayLabel(textNode('<p><strong>重点</strong> 内容</p>'));
    expect(label).not.toContain('<');
    expect(label.startsWith('重点')).toBe(true);
  });

  it('previews only the first block, not concatenated paragraphs', () => {
    expect(getNodeDisplayLabel(textNode('<p>First</p><p>Second</p>'))).toBe('First');
  });

  it('treats <br> as a line break', () => {
    expect(getNodeDisplayLabel(textNode('<p>Line1<br>Line2</p>'))).toBe('Line1');
  });

  it('decodes the common HTML entities Tiptap emits', () => {
    expect(getNodeDisplayLabel(textNode('<p>A &amp; B</p>'))).toBe('A & B');
    expect(getNodeDisplayLabel(textNode('<p>1 &lt; 2</p>'))).toBe('1 < 2');
  });

  it('still strips legacy markdown prefixes for tag-free content', () => {
    expect(getNodeDisplayLabel(textNode('# Heading'))).toBe('Heading');
    expect(getNodeDisplayLabel(textNode('- item one'))).toBe('item one');
  });

  it('truncates long previews with an ellipsis', () => {
    const label = getNodeDisplayLabel(textNode('<p>abcdefghijklmnop</p>'));
    expect(label).toBe('abcdefghij…');
  });

  it('falls back to "Text" when the body is empty markup', () => {
    expect(getNodeDisplayLabel(textNode('<p></p>'))).toBe('Text');
  });

  it('prefers an explicit, non-default title over the content preview', () => {
    expect(getNodeDisplayLabel(textNode('<p>body</p>', 'My Title'))).toBe('My Title');
  });

  it('ignores the placeholder "Text" title and previews content instead', () => {
    expect(getNodeDisplayLabel(textNode('<p>Hello</p>', 'Text'))).toBe('Hello');
  });
});
