// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/react';
import { createTextNodeExtensions } from './textNodeExtensions';

const makeEditor = (content: string) =>
  new Editor({
    extensions: createTextNodeExtensions('Type...'),
    content,
  });

describe('Text node Markdown subset', () => {
  it('supports lightweight headings, lists, quotes, and inline marks', () => {
    const editor = makeEditor([
      '# Title',
      '',
      '- one',
      '- two',
      '',
      '> quote',
      '',
      '**bold** *italic* ~~gone~~ `code`',
    ].join('\n'));

    const html = editor.getHTML();

    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<ul');
    expect(html).toContain('<li><p>one</p></li>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<s>gone</s>');
    expect(html).toContain('<code>code</code>');
    editor.destroy();
  });

  it('keeps document-heavy Markdown out of Text nodes', () => {
    const editor = makeEditor([
      '```ts',
      'const x = 1',
      '```',
      '',
      '---',
    ].join('\n'));

    const html = editor.getHTML();

    expect(html).not.toContain('<pre');
    expect(html).not.toContain('<hr');
    editor.destroy();
  });
});
