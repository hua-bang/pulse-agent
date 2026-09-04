import StarterKit from '@tiptap/starter-kit';
import Paragraph from '@tiptap/extension-paragraph';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { createLowlight } from 'lowlight';
import { Markdown } from 'tiptap-markdown';
import { syntaxHighlightLanguages } from '../../../utils/syntaxHighlightLanguages';
import { Callout } from '../runtime/calloutNode';
import { NoteSearchExtension } from '../runtime/noteSearchExtension';
import { MarkdownSafeImage } from './MarkdownSafeImage';

const lowlight = createLowlight(syntaxHighlightLanguages);
// Markdown collapses consecutive blank lines. The marker preserves one empty
// paragraph per user-created blank line through the markdown round trip.
const EMPTY_PARAGRAPH_MARKER = '\u00A0';

const EmptyLinePreservingParagraph = Paragraph.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          if (node.childCount === 0) state.write(EMPTY_PARAGRAPH_MARKER);
          else state.renderInline(node);
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});

export const createNoteEditorExtensions = (placeholder: string) => [
  StarterKit.configure({
    codeBlock: false,
    link: false,
    underline: false,
    paragraph: false,
  }),
  EmptyLinePreservingParagraph,
  MarkdownSafeImage.configure({ inline: false }),
  Callout,
  Placeholder.configure({ placeholder }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Underline,
  Highlight.configure({ multicolor: false }),
  Link.configure({
    openOnClick: false,
    autolink: true,
    linkOnPaste: true,
    protocols: ['pulse-canvas'],
    HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
  }),
  CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
  Table.configure({ resizable: false, HTMLAttributes: { class: 'note-table' } }),
  TableRow,
  TableHeader,
  TableCell,
  NoteSearchExtension,
  Markdown.configure({ html: false, transformPastedText: true }),
];
