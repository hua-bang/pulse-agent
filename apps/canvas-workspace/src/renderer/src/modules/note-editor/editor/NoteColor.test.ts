// @vitest-environment happy-dom
import { Editor } from '@tiptap/react';
import { expect, it } from 'vitest';
import { getMarkdown } from './useFileNodeEditor';
import { createNoteEditorExtensions } from './noteEditorExtensions';

it('round trips text and background colors with bold through Markdown', () => {
  const first = new Editor({ extensions: createNoteEditorExtensions(''), content: 'Hello world' });
  let second: Editor | undefined;
  try {
    first.commands.setTextSelection({ from: 1, to: 6 });
    first.chain().setMark('noteColor', { color: 'blue', background: 'yellow' }).toggleBold().run();
    const markdown = getMarkdown(first);
    second = new Editor({ extensions: createNoteEditorExtensions(''), content: markdown });
    expect(second.getHTML()).toContain('data-note-color="blue"');
    expect(second.getHTML()).toContain('data-note-background="yellow"');
    expect(second.getHTML()).toContain('<strong>');
    expect(second.getText()).toBe('Hello world');
  } finally { first.destroy(); second?.destroy(); }
});

it('keeps unrelated HTML disabled in Markdown', () => {
  const editor = new Editor({ extensions: createNoteEditorExtensions(''), content: 'Text <span onclick="alert(1)">untrusted</span>' });
  try { expect(editor.view.dom.querySelector('[onclick]')).toBeNull(); expect(editor.getText()).toContain('</span>'); } finally { editor.destroy(); }
});
