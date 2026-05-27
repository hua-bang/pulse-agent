import type { z } from "zod";

/**
 * Context passed to every template render. Currently just the data API
 * base URL — templates concatenate `${dsUrl}/stream` for SSE. The base
 * lets us change the API path later without touching every template.
 */
export interface TemplateRenderContext {
  /** Absolute URL of the datasource API base, no trailing slash. */
  dsUrl: string;
}

export interface TemplateDefinition<TParams = unknown> {
  /** Registry key — appears in spec.presentation.template. */
  id: string;
  /** One-line human-readable description; shown in the tool description. */
  description: string;
  /** Zod schema for `params`. Validated before render. */
  paramsSchema: z.ZodType<TParams>;
  /** Build the full HTML document string. */
  render(params: TParams, ctx: TemplateRenderContext): string;
}

/**
 * Wrap arbitrary HTML body in a minimal document with sane defaults.
 * Templates use this instead of repeating the boilerplate; the result
 * is what gets served at `GET /ui/<id>`.
 */
export function wrapDocument(opts: {
  title?: string;
  bodyCss?: string;
  externalCss?: string[];
  externalScripts?: string[];
  body: string;
}): string {
  const externalCss = (opts.externalCss ?? [])
    .map((href) => `<link rel="stylesheet" href="${href}">`)
    .join("\n");
  const externalScripts = (opts.externalScripts ?? [])
    .map((src) => `<script src="${src}"></script>`)
    .join("\n");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(opts.title ?? "datasource")}</title>
<style>
  html, body { margin: 0; padding: 0; }
  body { font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: #1f2328; }
  ${opts.bodyCss ?? ""}
</style>
${externalCss}
${externalScripts}
</head>
<body>
${opts.body}
</body>
</html>`;
}

/**
 * HTML-escape a string for safe interpolation into element bodies and
 * attribute values. Used for any LLM-provided param that appears as
 * text (label, title, etc.). For JS literal contexts use
 * `JSON.stringify` — it's safe AND handles escaping in one step.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
