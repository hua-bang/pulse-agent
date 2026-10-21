import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import type { ResolvedTheme } from '../../../../../shared/theme';

// defaultHighlightStyle inks are tuned for white paper. This style keeps the
// same tag roles and swaps in colors that stay readable on the dark surface.
const darkHighlightStyle = HighlightStyle.define([
  { tag: tags.meta, color: '#9a9a94' },
  { tag: tags.link, textDecoration: 'underline' },
  { tag: tags.heading, textDecoration: 'underline', fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.keyword, color: '#c792ea' },
  { tag: [tags.atom, tags.bool, tags.url, tags.contentSeparator, tags.labelName], color: '#82aaff' },
  { tag: [tags.literal, tags.inserted], color: '#addb67' },
  { tag: [tags.string, tags.deleted], color: '#ecc48d' },
  { tag: [tags.regexp, tags.escape, tags.special(tags.string)], color: '#f78c6c' },
  { tag: tags.definition(tags.variableName), color: '#82b1ff' },
  { tag: tags.local(tags.variableName), color: '#7fdbca' },
  { tag: [tags.typeName, tags.namespace], color: '#7fdbca' },
  { tag: tags.className, color: '#ffcb8b' },
  { tag: [tags.special(tags.variableName), tags.macroName], color: '#7fdbca' },
  { tag: tags.definition(tags.propertyName), color: '#80cbc4' },
  { tag: tags.comment, color: '#8a8a85' },
  { tag: tags.invalid, color: '#ff6b6b' },
], { themeType: 'dark' });

/** Syntax colors plus the darkTheme facet, which switches CodeMirror's own
 *  base styles (selection, panels, matching brackets) to their dark set. */
export const editorHighlighting = (theme: ResolvedTheme): Extension => [
  EditorView.darkTheme.of(theme === 'dark'),
  syntaxHighlighting(theme === 'dark' ? darkHighlightStyle : defaultHighlightStyle, { fallback: true }),
];
