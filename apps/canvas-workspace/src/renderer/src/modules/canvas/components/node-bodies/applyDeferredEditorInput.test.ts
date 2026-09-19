// @vitest-environment happy-dom
import { Editor } from '@tiptap/react';
import { expect, it, vi } from 'vitest';
import { getMarkdown } from '../../../note-editor';
import { createNoteEditorExtensions } from '../../../note-editor/editor/noteEditorExtensions';
import { createTextNodeExtensions } from './TextNodeBody/textNodeExtensions';
import { applyDeferredEditorInput } from './applyDeferredEditorInput';

it('hands DOM focus to the real editor synchronously before the buffer may hide', () => {
  vi.useFakeTimers();
  const buffer = document.createElement('div');
  buffer.contentEditable = 'true';
  buffer.tabIndex = 0;
  const element = document.createElement('div');
  document.body.append(buffer, element);
  const focusedUpdates: boolean[] = [];
  const editor = new Editor({ element, extensions: createTextNodeExtensions(''), content: '<p>Original</p>',
    onUpdate: ({ editor: current }) => { focusedUpdates.push(current.isFocused); },
  });
  try {
    buffer.focus();
    expect(document.activeElement).toBe(buffer);
    expect(applyDeferredEditorInput(editor, { html: '<strong> typed</strong>', text: ' typed', deletions: [] })).toBe(true);
    expect(document.activeElement).toBe(editor.view.dom);
    expect(editor.getHTML()).toContain('Original<strong> typed</strong>');
    expect(focusedUpdates).toEqual([true]);
  } finally {
    editor.destroy();
    buffer.remove();
    element.remove();
    vi.useRealTimers();
  }
});

it('preserves pasted HTML through the File editor schema without parsing it as Markdown again', () => {
  vi.useFakeTimers();
  const element = document.createElement('div');
  document.body.append(element);
  const editor = new Editor({ element, extensions: createNoteEditorExtensions(''), content: '# Note\n\nOriginal' });
  try {
    applyDeferredEditorInput(editor, { html: '<strong> RICH</strong>', text: ' RICH', deletions: [] });
    expect(editor.getHTML()).toContain('<strong> RICH</strong>');
    expect(getMarkdown(editor)).toContain('**RICH**');
    expect(document.activeElement).toBe(editor.view.dom);
  } finally {
    editor.destroy();
    element.remove();
    vi.useRealTimers();
  }
});
