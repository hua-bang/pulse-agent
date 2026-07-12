// @vitest-environment happy-dom
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
import { duplicateCurrentNoteBlock, moveCurrentNoteBlock } from './noteBlockCommands';

const createEditor = () => new Editor({
  extensions: [StarterKit],
  content: '<p>Alpha</p><p>Beta</p><p>Gamma</p>',
});

describe('note block commands', () => {
  it('moves the current top-level block without changing its content', () => {
    const editor = createEditor();
    editor.commands.setTextSelection(8);

    expect(moveCurrentNoteBlock(editor, -1)).toBe(true);
    expect(editor.getText({ blockSeparator: '|' })).toBe('Beta|Alpha|Gamma');
    editor.destroy();
  });

  it('duplicates the current top-level block after itself', () => {
    const editor = createEditor();
    editor.commands.setTextSelection(2);

    expect(duplicateCurrentNoteBlock(editor)).toBe(true);
    expect(editor.getText({ blockSeparator: '|' })).toBe('Alpha|Alpha|Beta|Gamma');
    editor.destroy();
  });

  it('moves the current block down without changing sibling content', () => {
    const editor = createEditor();
    editor.commands.setTextSelection(2);

    expect(moveCurrentNoteBlock(editor, 1)).toBe(true);
    expect(editor.getText({ blockSeparator: '|' })).toBe('Beta|Alpha|Gamma');
    editor.destroy();
  });

  it('does nothing beyond the first and last document boundaries', () => {
    const editor = createEditor();
    editor.commands.setTextSelection(2);
    expect(moveCurrentNoteBlock(editor, -1)).toBe(false);
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(moveCurrentNoteBlock(editor, 1)).toBe(false);
    expect(editor.getText({ blockSeparator: '|' })).toBe('Alpha|Beta|Gamma');
    editor.destroy();
  });
});
