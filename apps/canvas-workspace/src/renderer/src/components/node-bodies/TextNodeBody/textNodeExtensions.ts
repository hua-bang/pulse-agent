import Highlight from "@tiptap/extension-highlight";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { TextColorMark } from "./textColorMark";

export const createTextNodeExtensions = (placeholder: string) => [
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
    placeholder,
    showOnlyWhenEditable: false,
  }),
  Markdown.configure({ html: true, transformPastedText: true, breaks: true }),
];
