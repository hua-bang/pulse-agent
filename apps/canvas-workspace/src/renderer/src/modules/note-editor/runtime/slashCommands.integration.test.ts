// @vitest-environment happy-dom
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
import { Callout } from './calloutNode';
import { ALL_SLASH_COMMANDS } from './slashCommands';

const command = (id: string) => {
  const result = ALL_SLASH_COMMANDS.find((item) => item.id === id);
  if (!result) throw new Error(`Missing slash command: ${id}`);
  return result;
};

const createEditor = (content: string) => new Editor({
  extensions: [StarterKit, Callout],
  content,
});

describe('slash block transformations', () => {
  it('turns a quote into a heading instead of nesting the target inside it', () => {
    const editor = createEditor('<blockquote><p>Alpha</p></blockquote>');
    editor.commands.setTextSelection(2);

    command('h2').run(editor, 2, 2);

    expect(editor.isActive('heading', { level: 2 })).toBe(true);
    expect(editor.isActive('blockquote')).toBe(false);
    editor.destroy();
  });

  it('round-trips a paragraph through a callout and back to text', () => {
    const editor = createEditor('<p>Alpha</p>');
    editor.commands.setTextSelection(2);

    command('callout').run(editor, 2, 2);
    expect(editor.isActive('callout')).toBe(true);

    command('text').run(editor, 2, 2);
    expect(editor.isActive('callout')).toBe(false);
    expect(editor.isActive('paragraph')).toBe(true);
    editor.destroy();
  });
});
