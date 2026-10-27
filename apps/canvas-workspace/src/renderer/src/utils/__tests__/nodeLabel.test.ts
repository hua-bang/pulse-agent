import { describe, expect, it } from 'vitest';
import type { CanvasNode } from '../../types';
import { getNodeDisplayLabel, nodeClipboardText } from '../nodeLabel';

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
    const label = getNodeDisplayLabel(textNode('<p>abcdefghijklmnopqrstuvwxyz0123</p>'));
    expect(label).toBe('abcdefghijklmnopqrstuvwx…');
  });

  it('falls back to "Text" when the body is empty markup', () => {
    expect(getNodeDisplayLabel(textNode('<p></p>'))).toBe('Text');
  });

  it('prefers an explicit, non-default title over the content preview', () => {
    expect(getNodeDisplayLabel(textNode('<p>body</p>', 'My Title'))).toBe('My Title');
  });

  it('ignores the placeholder "Text" title and previews content instead', () => {
    expect(getNodeDisplayLabel(textNode('<p>Hello</p>', 'Text'))).toBe('Hello');
    // A text node created in a Chinese UI stores the Chinese placeholder.
    expect(getNodeDisplayLabel(textNode('<p>Hello</p>', '文本'))).toBe('Hello');
  });
});

describe('getNodeDisplayLabel — notes', () => {
  const note = (title: string, content: string): CanvasNode => ({
    ...textNode('', title),
    type: 'file',
    data: { filePath: '', content, saved: false, modified: false },
  } as unknown as CanvasNode);

  // Regression: a new note stayed "Untitled" in Layers, Library and Find
  // even after its first line was written.
  it('names an untitled note by its first line', () => {
    expect(getNodeDisplayLabel(note('Untitled', '# Meeting plan\n\nAgenda'))).toBe('Meeting plan');
    expect(getNodeDisplayLabel(note('未命名', '周会安排'))).toBe('周会安排');
  });

  it('keeps a title the user chose, and the default for an empty note', () => {
    expect(getNodeDisplayLabel(note('Roadmap', '# Meeting plan'))).toBe('Roadmap');
    expect(getNodeDisplayLabel(note('Untitled', ''))).toBe('Untitled');
  });
});

describe('nodeClipboardText', () => {
  it('falls back to the label for an empty text node', () => {
    expect(nodeClipboardText(textNode('<p></p>', 'Text'))).toBe('Text');
  });

  it('writes a mind map as an indented outline', () => {
    const mindmap = {
      ...textNode(''),
      type: 'mindmap',
      data: {
        layout: 'right',
        root: {
          id: 'r',
          text: 'Root',
          children: [{ id: 'a', text: 'A', children: [{ id: 'b', text: 'B', children: [] }] }],
        },
      },
    } as CanvasNode;
    expect(nodeClipboardText(mindmap)).toBe('Root\n  - A\n    - B');
  });

  it('tolerates leaf topics without a children array', () => {
    const mindmap = {
      ...textNode(''),
      type: 'mindmap',
      data: { layout: 'right', root: { id: 'r', text: 'Root', children: [{ id: 'a', text: 'A' }] } },
    } as unknown as CanvasNode;
    expect(nodeClipboardText(mindmap)).toBe('Root\n  - A');
  });
});
