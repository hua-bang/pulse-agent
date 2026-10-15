import type { CanvasNode, MindmapNodeData, PluginNodeData, ReferenceNodeData, TextNodeData } from '../types';

const TEXT_LABEL_MAX_CHARS = 10;
const MINDMAP_LABEL_MAX_CHARS = 16;

/**
 * Resolve the display label for a canvas node.
 *
 * Text nodes don't carry an editable title — their header sits empty and the
 * actual prose lives in `data.content`. Showing "Text" everywhere is useless
 * when several text nodes coexist, so we derive a short preview from the
 * content (first ~10 chars of the first non-empty line, stripped of HTML markup
 * and common markdown prefixes). Falls back to "Text" when the node is empty.
 *
 * Non-text nodes pass through untouched so this stays a single lookup at all
 * call sites (sidebar, mention picker, etc.).
 */
export function getNodeDisplayLabel(node: CanvasNode): string {
  if (node.type === "text") {
    const explicitTitle = node.title.trim();
    if (explicitTitle && explicitTitle !== 'Text') return explicitTitle;

    const preview = textContentPreview((node.data as TextNodeData).content);
    if (preview) return preview;
    return node.title || "Text";
  }

  if (node.type === "mindmap") {
    const rootText = (node.data as MindmapNodeData).root?.text?.trim();
    if (!rootText) return node.title || "Mindmap";
    return rootText.length <= MINDMAP_LABEL_MAX_CHARS
      ? rootText
      : `${rootText.slice(0, MINDMAP_LABEL_MAX_CHARS)}…`;
  }

  if (node.type === "reference") {
    const data = node.data as ReferenceNodeData;
    return data.titleSnapshot?.trim() || node.title || "Reference";
  }

  if (node.type === "plugin") {
    const data = node.data as Partial<PluginNodeData>;
    return node.title?.trim() || data.nodeType || "Plugin node";
  }

  return node.title;
}

/**
 * Tiptap persists text-node content as HTML (`editor.getHTML()`), so the raw
 * value looks like `<p>如何理解 Harness</p>`. A sidebar/mention label wants the
 * prose, not the markup: turn block boundaries and `<br>` into line breaks (so
 * the first-line logic still works and words don't run together), drop the
 * remaining tags, then decode the handful of entities Tiptap emits. Legacy
 * plain-markdown content has no tags, so it passes through unchanged.
 */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote|pre|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    // Decode &amp; last so an escaped entity like `&amp;lt;` survives as text.
    .replace(/&amp;/gi, "&");
}

/**
 * Pull a short plaintext-ish preview out of a text-node body.
 *
 * Strips HTML markup (Tiptap output) and leading markdown markers (`# `, `- `,
 * `* `, `> `, etc.) so the user sees the actual first words instead of a tag or
 * formatting glyph, then keeps the first N chars with an ellipsis if we cut.
 */
function textContentPreview(content: string | undefined): string {
  if (!content) return "";

  const firstLine = htmlToPlainText(content)
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line.length > 0);
  if (!firstLine) return "";

  const stripped = firstLine
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^>\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .trim();
  if (!stripped) return "";

  // UTF-16 code-unit length is fine for CJK (BMP, 1 unit per char). It can
  // split surrogate pairs (emoji, rare Han outside BMP) in half — good enough
  // for a sidebar label; we'd lean on Intl.Segmenter only if this became a
  // user-visible problem.
  if (stripped.length <= TEXT_LABEL_MAX_CHARS) return stripped;
  return `${stripped.slice(0, TEXT_LABEL_MAX_CHARS)}…`;
}
