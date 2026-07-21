---
name: pdf-node
description: Attach, read, and navigate PDF document plugin nodes in Pulse Canvas.
---

# PDF Document Node

Use this skill when the user wants to bring a PDF file onto the canvas, read
or quote its content, or navigate it.

## Node Identity

Create PDF documents as plugin nodes:

```json
{
  "type": "plugin",
  "title": "Quarterly Report",
  "data": {
    "pluginId": "pulse-canvas-nodes",
    "nodeType": "pdf.document",
    "payload": {}
  }
}
```

The node renders the PDF with Chromium's built-in viewer inside a webview. The
payload stores a reference to the file on disk (`source.path`), never the PDF
bytes — moving or deleting the file breaks the node until a new source is set.

## Preferred Workflow

1. If no PDF node exists, call `canvas_create_node` with the plugin node
   identity above.
2. Attach a file with `canvas_plugin_node_action` action `set_source` and an
   absolute path, or tell the user to click "Choose PDF file" on the node.
3. Read content with `canvas_read_node` / `canvas_plugin_node_read` — the
   `content` field contains an extracted text excerpt.
4. For specific pages or longer content, use action `extract_text` with a page
   selection.

## Actions

Use `canvas_plugin_node_action` with:

- `set_source`: attach a PDF. Input: `path` (absolute `.pdf` path, required),
  `title` (optional). Resets `currentPage` to 1 and probes `pageCount`.
- `extract_text`: extract text. Input: `pages` (optional — a number, an array,
  or a range string like `"1-3,5"`; omit for all pages), `maxChars` (optional,
  default 20000). Returns `text` with `[Page N]` markers and a `truncated` flag.
- `go_to_page`: navigate the viewer. Input: `page` (number, clamped to the
  document's page range).
- `summarize`: return file name, path, page count, and current page without
  reading content.

## Reading Notes

- `read` extracts text lazily and caches it per file fingerprint; documents
  over 30 pages are excerpted from the first 10 pages — use `extract_text`
  with explicit `pages` for the rest.
- Scanned/image-only PDFs yield little or no text; the excerpt says so rather
  than failing.
- `write` accepts payload patches (`title`, `currentPage`, `source`) but
  `set_source` is preferred because it validates the file and probes the page
  count.
