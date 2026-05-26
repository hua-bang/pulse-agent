/**
 * webview-page-control — canvas plugin.
 *
 * Registers a set of canvas-agent tools (`page_eval`, `page_click`,
 * `page_click_at`, `page_fill`, `page_press`, `page_scroll`,
 * `page_wait_for`) that let the agent control pages inside iframe
 * canvas nodes via CDP. Gated by the `webview-page-control` experimental
 * flag — when off, the plugin doesn't activate at all and the agent
 * never sees the tool names.
 *
 * URL policy and CDP infrastructure live in sibling files inside this
 * folder; the only outward dependency is on `main/webview/cdp-session.ts`
 * (shared with the reader path so they don't fight over the debugger
 * slot) and `main/webview/registry.ts` (live `WebContents` lookup).
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { MainCanvasPlugin } from '../../types';
import {
  EXPERIMENTAL_FLAG_WEBVIEW_PAGE_CONTROL,
  resolveFeatureValues,
} from '../../../shared/experimental-features';
import { createWebviewPageControlTools } from './tools';

function experimentalFlagsPath(): string {
  const envPath = process.env.PULSE_CANVAS_EXPERIMENTAL_FEATURES?.trim();
  return envPath || join(homedir(), '.pulse-coder', 'canvas', 'experimental-features.json');
}

/**
 * Synchronous flag read — `enabledWhen` runs at plugin registration time
 * (in `setupCanvasPlugins`), before the renderer is up, so we cannot
 * round-trip through IPC. Mirrors the same approach the
 * experimental-features sync preload uses. Missing / unparseable file
 * falls through to registry defaults (flag off → plugin inactive).
 */
function isWebviewPageControlEnabled(): boolean {
  let overrides: Record<string, boolean> = {};
  try {
    const raw = readFileSync(experimentalFlagsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'boolean') overrides[k] = v;
      }
    }
  } catch {
    overrides = {};
  }
  return resolveFeatureValues(overrides)[EXPERIMENTAL_FLAG_WEBVIEW_PAGE_CONTROL] === true;
}

export const WebviewPageControlPlugin: MainCanvasPlugin = {
  id: 'webview-page-control',
  enabledWhen: isWebviewPageControlEnabled,
  activate(ctx) {
    ctx.registerCanvasTool((workspaceId) => createWebviewPageControlTools(workspaceId));
  },
};
