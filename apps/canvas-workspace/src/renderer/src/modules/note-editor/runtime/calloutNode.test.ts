// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { Callout } from './calloutNode';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeEditor = (content?: any) =>
  new Editor({ extensions: [StarterKit, Markdown, Callout], content });

const calloutDoc = (icon: string, text: string) => ({
  type: 'doc',
  content: [
    {
      type: 'callout',
      attrs: { icon },
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    },
  ],
});

describe('Callout markdown round-trip', () => {
  it('serializes a callout to a GitHub-style alert blockquote', () => {
    const editor = makeEditor(calloutDoc('💡', 'hello'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const md = (editor.storage as any).markdown.getMarkdown();
    expect(md).toContain('> [!💡]');
    expect(md).toContain('hello');
    editor.destroy();
  });

  it('parses an alert blockquote back into a callout node', () => {
    const editor = makeEditor('> [!💡]\n>\n> hello');
    expect(JSON.stringify(editor.getJSON())).toContain('"callout"');
    editor.destroy();
  });

  it('round-trips (serialize → reload) preserving the callout, icon, and text', () => {
    const e1 = makeEditor(calloutDoc('⚠️', 'careful'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const md = (e1.storage as any).markdown.getMarkdown();
    e1.destroy();

    const e2 = makeEditor(md);
    const json = JSON.stringify(e2.getJSON());
    expect(json).toContain('"callout"');
    expect(json).toContain('careful');
    expect(json).toContain('⚠️');
    e2.destroy();
  });

  it('leaves an ordinary blockquote as a blockquote', () => {
    const editor = makeEditor('> just a quote');
    const json = JSON.stringify(editor.getJSON());
    expect(json).toContain('"blockquote"');
    expect(json).not.toContain('"callout"');
    editor.destroy();
  });
});
