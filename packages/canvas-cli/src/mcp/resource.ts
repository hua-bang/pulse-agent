import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { ReadResourceResult, Resource } from '@modelcontextprotocol/sdk/types.js';
import { NODE_VIEW_RESOURCE_URI } from './tools';

export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';

/**
 * The node view is built by apps/canvas-workspace (`build:node-view`) from the
 * app's own node bodies; packaging places it next to `dist/index.cjs`. This
 * package only serves it, so it never depends on the app at build time.
 */
export const NODE_VIEW_FILE = 'node-view.html';

/** Lets tests and the E2E tool point at a specific build. */
export const NODE_VIEW_PATH_ENV = 'PULSE_CANVAS_NODE_VIEW_HTML';

const FALLBACK_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Pulse Canvas</title></head>
<body style="font-family: system-ui, sans-serif; padding: 16px;">
<p>This Pulse Canvas CLI was installed without its node view. Update the Pulse Canvas app;
the canvas tools keep working meanwhile.</p>
</body></html>`;

function viewCandidates(): string[] {
  const appBuild = ['apps', 'canvas-workspace', 'dist', 'node-view', NODE_VIEW_FILE];
  return [
    process.env[NODE_VIEW_PATH_ENV] ?? '',
    // Packaged app: copied beside the bundled CLI.
    join(__dirname, NODE_VIEW_FILE),
    // Monorepo runs from packages/canvas-cli/dist or src/mcp.
    join(__dirname, '..', '..', '..', ...appBuild),
    join(__dirname, '..', '..', '..', '..', ...appBuild),
  ].filter(Boolean);
}

export function loadNodeViewHtml(): string {
  const path = viewCandidates().find(candidate => existsSync(candidate));
  return path ? readFileSync(path, 'utf-8') : FALLBACK_HTML;
}

const resourceMeta = {
  // Self-contained: no network, fonts, or nested frames.
  ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true },
  'openai/widgetDescription': 'A Pulse Canvas node (mindmap, text, or note) shown as it appears in the app.',
  'openai/widgetPrefersBorder': true,
};

export const NODE_VIEW_RESOURCE: Resource = {
  uri: NODE_VIEW_RESOURCE_URI,
  name: 'pulse-canvas-node',
  title: 'Pulse Canvas node',
  description: 'One Pulse Canvas node rendered with the app\'s own components.',
  mimeType: MCP_APP_MIME_TYPE,
  _meta: resourceMeta,
};

export function readNodeViewResource(): ReadResourceResult {
  return {
    contents: [{
      uri: NODE_VIEW_RESOURCE_URI,
      mimeType: MCP_APP_MIME_TYPE,
      // Read per request so an app update is picked up without restarting the server.
      text: loadNodeViewHtml(),
      _meta: resourceMeta,
    }],
  };
}
