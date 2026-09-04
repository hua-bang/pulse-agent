// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/react';
import { createTextNodeExtensions } from './textNodeExtensions';

const makeEditor = (content = '<p>hello world</p>') =>
  new Editor({
    extensions: createTextNodeExtensions('Type...'),
    content,
  });

describe('TextColorMark', () => {
  it('persists selected text color and highlight as HTML', () => {
    const editor = makeEditor();
    editor.commands.setTextSelection({ from: 1, to: 6 });
    editor.chain().setMark('textColor', { color: '#e03131' }).setHighlight({ color: '#fff3bf' }).run();

    const html = editor.getHTML();

    expect(html).toContain('color: #e03131');
    expect(html).toContain('background-color: #fff3bf');
    editor.destroy();
  });

  it('parses saved text color spans back into the mark', () => {
    const editor = makeEditor('<p><span style="color: #1c7ed6">blue</span> text</p>');

    expect(editor.getHTML()).toContain('color: #1c7ed6');
    editor.destroy();
  });
});
