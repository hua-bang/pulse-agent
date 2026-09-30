import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { ReadResourceResult, Resource } from '@modelcontextprotocol/sdk/types.js';
import { CANVAS_APP_RESOURCE_URI } from './tools';

export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';

/** Built by `scripts/build-mcp-app.mjs` next to `dist/index.cjs`. */
export const MCP_APP_BUNDLE_FILE = 'mcp-app.html';

const FALLBACK_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Pulse Canvas</title></head>
<body style="font-family: system-ui, sans-serif; padding: 24px;">
<p>The Pulse Canvas view is not bundled in this build. Rebuild <code>@pulse-coder/canvas-cli</code>
or update Pulse Canvas; the canvas tools still work without the view.</p>
</body></html>`;

function bundleCandidates(): string[] {
  return [
    join(__dirname, MCP_APP_BUNDLE_FILE),
    // Source runs (tests, tsx) resolve the last package build.
    join(__dirname, '..', '..', 'dist', MCP_APP_BUNDLE_FILE),
  ];
}

let cachedHtml: string | undefined;

export function loadCanvasAppHtml(): string {
  if (cachedHtml !== undefined) return cachedHtml;
  const path = bundleCandidates().find(candidate => existsSync(candidate));
  cachedHtml = path ? readFileSync(path, 'utf-8') : FALLBACK_HTML;
  return cachedHtml;
}

const resourceMeta = {
  // The view is self-contained: no network, fonts, or nested frames.
  ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: false },
  'openai/widgetDescription': 'Interactive Pulse Canvas workspace: nodes, edges, and notes the user can edit.',
  'openai/widgetPrefersBorder': false,
};

export const CANVAS_APP_RESOURCE: Resource = {
  uri: CANVAS_APP_RESOURCE_URI,
  name: 'pulse-canvas-workspace',
  title: 'Pulse Canvas',
  description: 'Interactive view of a Pulse Canvas workspace.',
  mimeType: MCP_APP_MIME_TYPE,
  _meta: resourceMeta,
};

export function readCanvasAppResource(): ReadResourceResult {
  return {
    contents: [{
      uri: CANVAS_APP_RESOURCE_URI,
      mimeType: MCP_APP_MIME_TYPE,
      text: loadCanvasAppHtml(),
      _meta: resourceMeta,
    }],
  };
}
