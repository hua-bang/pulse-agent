import { z } from 'zod';
import { getWebContentsForNode } from '../../webview/registry';
import { ensureOperable } from '../../webview/ensure-operable';
import { activateWorkspaceWindow } from '../../app/window-manager';
import { readDOM, readA11y, captureScreenshot } from '../../webview/reader';
import { getCurrentVersionContent } from '../../artifacts/store';
import { getSessionScrollback } from '../../terminal/scrollback';
import type { CanvasTool } from './types';

const READINESS_HINT =
  'This is a point-in-time read of a live tab. A "success" does not guarantee the ' +
  'content finished loading — if the data you need looks empty or missing, wait and read again.';

/**
 * Read the live content of a right-dock tab the user `@`-mentioned.
 *
 * Dispatches by tab kind, reusing the existing readers:
 *  - link      → the tab's embedded <webview> (registered under the tab id),
 *                read via the same dom → a11y → screenshot cascade as
 *                canvas_read_webpage.
 *  - artifact  → the current version content from the artifact store.
 *  - terminal  → the capped scrollback tail kept by the PTY manager.
 *  - node-detail → routed to canvas_read_node (a node-detail tab is a canvas
 *                node); this tool returns a pointer rather than duplicating the
 *                node-read path.
 */
export function createTabTools(workspaceId: string): Record<string, CanvasTool> {
  return {
    canvas_read_tab: {
      name: 'canvas_read_tab',
      defer_loading: true,
      description:
        'Read the live content of a right-dock tab the user `@`-mentioned (the browser-like tabs at the top of the dock).\n' +
        'The "Referenced Tabs" block in the request context lists each mentioned tab with the exact parameters to pass here.\n\n' +
        'By `kind`:\n' +
        '- link: reads the open web page inside the tab (auto strategy: dom → a11y → screenshot). Pass `tabId` (and `strategy`/`maxChars` if needed).\n' +
        '- artifact: returns the current version content. Pass `artifactId`.\n' +
        '- terminal: returns the terminal scrollback (recent output). Pass `sessionId`.\n' +
        '- node-detail: a node-detail tab is a canvas node — call `canvas_read_node({ nodeId })` instead.\n\n' +
        'For a `screenshot` result, call canvas_analyze_image({ imagePaths: [imagePath] }) to get a vision description.',
      inputSchema: z.object({
        kind: z
          .enum(['link', 'artifact', 'terminal', 'node-detail'])
          .describe('Tab kind, taken from the Referenced Tabs block.'),
        tabId: z.string().optional().describe('For kind="link": the dock tab id (also the webview registry key).'),
        url: z.string().optional().describe('For kind="link": the current page URL (informational).'),
        artifactId: z.string().optional().describe('For kind="artifact": the artifact id.'),
        sessionId: z.string().optional().describe('For kind="terminal": the PTY session id.'),
        nodeId: z.string().optional().describe('For kind="node-detail": the canvas node id (use canvas_read_node instead).'),
        strategy: z
          .enum(['auto', 'dom', 'a11y', 'screenshot'])
          .optional()
          .describe('For kind="link": reading strategy. Defaults to "auto".'),
        maxChars: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('For kind="link"/"terminal": max characters of text. Defaults to 12 000 (link) / all (terminal).'),
      }),
      execute: async (input) => {
        const kind = input.kind as 'link' | 'artifact' | 'terminal' | 'node-detail';
        const targetWorkspaceId = (input.workspaceId as string) || workspaceId;

        if (kind === 'node-detail') {
          const nodeId = (input.nodeId as string) || '';
          return JSON.stringify({
            ok: false,
            kind,
            error:
              'A node-detail tab is a canvas node. ' +
              `Call canvas_read_node({ nodeId: "${nodeId}"${targetWorkspaceId ? `, workspaceId: "${targetWorkspaceId}"` : ''} }) to read it.`,
          });
        }

        if (kind === 'artifact') {
          const artifactId = (input.artifactId as string) || '';
          if (!artifactId) return JSON.stringify({ ok: false, kind, error: 'artifactId is required for an artifact tab.' });
          const artifact = await getCurrentVersionContent(targetWorkspaceId, artifactId);
          if (!artifact) return JSON.stringify({ ok: false, kind, error: `Artifact not found: ${artifactId}` });
          return JSON.stringify({
            ok: true,
            kind,
            artifactType: artifact.type,
            title: artifact.title,
            content: artifact.content,
          });
        }

        if (kind === 'terminal') {
          const sessionId = (input.sessionId as string) || '';
          if (!sessionId) return JSON.stringify({ ok: false, kind, error: 'sessionId is required for a terminal tab.' });
          const maxChars = input.maxChars as number | undefined;
          const result = maxChars ? getSessionScrollback(sessionId, maxChars) : getSessionScrollback(sessionId);
          return JSON.stringify(result.ok
            ? { ok: true, kind, sessionId, text: result.text, textLength: (result.text ?? '').length }
            : { ok: false, kind, error: result.error });
        }

        // kind === 'link'
        const tabId = (input.tabId as string) || '';
        if (!tabId) return JSON.stringify({ ok: false, kind, error: 'tabId is required for a link tab.' });
        const strategy = (input.strategy as 'auto' | 'dom' | 'a11y' | 'screenshot') ?? 'auto';
        const maxChars = (input.maxChars as number) ?? 12_000;
        const sparseThreshold = 200;

        const wc = await ensureOperable({
          lookup: () => getWebContentsForNode(targetWorkspaceId, tabId),
          activate: () => activateWorkspaceWindow(targetWorkspaceId),
          mode: strategy === 'screenshot' ? 'operate' : 'read',
        });
        if (!wc) {
          return JSON.stringify({
            ok: false,
            kind,
            error:
              `No active webview for link tab ${tabId} in workspace ${targetWorkspaceId}. ` +
              'Make sure the tab is open in the dock and has finished loading.',
          });
        }

        if (strategy === 'dom' || strategy === 'auto') {
          const r = await readDOM(wc, maxChars);
          if (strategy === 'dom') {
            return JSON.stringify(r.ok
              ? { ok: true, kind, strategy: 'dom', title: r.title, url: r.url, text: r.text, textLength: r.text.trim().length, hint: READINESS_HINT }
              : { ok: false, kind, strategy: 'dom', error: r.error });
          }
          if (r.ok && r.text.trim().length >= sparseThreshold) {
            return JSON.stringify({ ok: true, kind, strategy: 'dom', title: r.title, url: r.url, text: r.text, textLength: r.text.trim().length, hint: READINESS_HINT });
          }
        }

        if (strategy === 'a11y' || strategy === 'auto') {
          const r = await readA11y(wc);
          if (strategy === 'a11y') {
            return JSON.stringify(r.ok
              ? { ok: true, kind, strategy: 'a11y', text: r.text, textLength: r.text.trim().length, hint: READINESS_HINT }
              : { ok: false, kind, strategy: 'a11y', error: r.error });
          }
          if (r.ok && r.text.trim().length >= sparseThreshold) {
            return JSON.stringify({ ok: true, kind, strategy: 'a11y', text: r.text, textLength: r.text.trim().length, hint: READINESS_HINT });
          }
        }

        const r = await captureScreenshot(wc);
        return JSON.stringify(r.ok
          ? { ok: true, kind, strategy: 'screenshot', imagePath: r.imagePath,
              hint: 'Call canvas_analyze_image({ imagePaths: [imagePath] }) to get a vision description.' }
          : { ok: false, kind, strategy: 'screenshot', error: r.error });
      },
    },
  };
}
