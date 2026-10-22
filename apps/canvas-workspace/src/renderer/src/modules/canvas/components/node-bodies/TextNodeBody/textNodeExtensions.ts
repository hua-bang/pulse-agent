import Highlight from "@tiptap/extension-highlight";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { TextColorMark } from "./textColorMark";

/** `editingPlaceholder` replaces the "how to edit" hint once the node is
 *  already in edit mode, where that hint would be wrong. */
export const createTextNodeExtensions = (placeholder: string, editingPlaceholder = placeholder) => [
  // Text nodes stay intentionally lighter than Note cards: enough Markdown
  // for labels and short annotations, without rich document blocks.
  StarterKit.configure({
    underline: false,
    codeBlock: false,
    horizontalRule: false,
  }),
  Underline,
  TextColorMark,
  Highlight.configure({ multicolor: true }),
  Placeholder.configure({
    placeholder: ({ editor }) => (editor.isEditable ? editingPlaceholder : placeholder),
    showOnlyWhenEditable: false,
  }),
  Markdown.configure({ html: true, transformPastedText: true, breaks: true }),
];
