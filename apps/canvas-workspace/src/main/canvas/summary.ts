/**
 * Read-only canvas previews for the launcher.
 *
 * Channels:
 *   canvas:summaries  ({ ids })  → { ok, summaries: Record<id, CanvasSummary | null> }
 *                                  (null when a stored canvas cannot be read)
 *
 * Unlike `canvas:load`, this never migrates, recovers, writes, seeds merge
 * state, or starts watchers. It reads the stored layout and keeps only the
 * node count and the first few card and frame boxes and titles, so the renderer gets a few
 * hundred bytes per workspace instead of the full node payload.
 */

import { ipcMain } from 'electron';
import type { CanvasSummary, CanvasSummaryBox } from '../../shared/canvas';
import { DEFAULT_TEXT_NODE_TITLES } from '../../shared/canvas-node-defaults';
import { getCanvasBackend } from './persistence/backend';
import { readJsonWithRecovery } from './persistence/atomic-json';
import { MANIFEST_ID, STORE_DIR, getCanvasJsonPath } from './persistence/paths';
import { isSafeNodeId } from './nodes/store';

// Canvas reference cards draw the whole layout; the launcher keeps only its
// first few cards. A box is under 100 bytes, so this stays small.
const SUMMARY_BOX_LIMIT = 24;
const SUMMARY_FRAME_LIMIT = 12;
const SUMMARY_ID_LIMIT = 20;
const SUMMARY_TITLE_LIMIT = 60;
const EMPTY_SUMMARY: CanvasSummary = { nodeCount: 0, boxes: [] };

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Text nodes keep their words in `data.content` (Tiptap HTML). v2 layouts
 * strip node data, so this only fills in where the store still has it. */
const textFirstLine = (data: unknown): string => {
  const content = (data as { content?: unknown } | undefined)?.content;
  if (typeof content !== 'string') return '';
  return content
    .replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6]|blockquote|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    // Decode &amp; last so an escaped entity like `&amp;lt;` survives as text.
    .replace(/&amp;/gi, '&')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) ?? '';
};

const toBox = (node: unknown): CanvasSummaryBox | null => {
  if (!node || typeof node !== 'object') return null;
  const { type, title, x, y, width, height, data } = node as Record<string, unknown>;
  if (typeof type !== 'string') return null;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) {
    return null;
  }
  if (width <= 0 || height <= 0) return null;
  const label = type === 'text' ? textFirstLine(data) || (DEFAULT_TEXT_NODE_TITLES.has(title) ? '' : title) : title;
  const shortTitle = typeof label === 'string' ? label.trim().slice(0, SUMMARY_TITLE_LIMIT) : '';
  const box: CanvasSummaryBox = shortTitle ? { type, title: shortTitle, x, y, width, height } : { type, x, y, width, height };
  const color = (data as { color?: unknown } | undefined)?.color;
  if (type === 'frame' && typeof color === 'string' && color) box.color = color;
  return box;
};

/** Reduces stored canvas data to a preview. Works on v1, v2 layout, and SQLite shapes. */
export const summarizeCanvasData = (data: unknown): CanvasSummary | null => {
  if (!data || typeof data !== 'object') return null;
  const { nodes } = data as { nodes?: unknown };
  const list = Array.isArray(nodes) ? nodes : [];
  const boxes: CanvasSummaryBox[] = [];
  const frames: CanvasSummaryBox[] = [];
  for (const node of list) {
    if (boxes.length >= SUMMARY_BOX_LIMIT && frames.length >= SUMMARY_FRAME_LIMIT) break;
    const box = toBox(node);
    if (!box) continue;
    if (box.type === 'frame') {
      if (frames.length < SUMMARY_FRAME_LIMIT) frames.push(box);
    } else if (boxes.length < SUMMARY_BOX_LIMIT) {
      boxes.push(box);
    }
  }
  return frames.length > 0 ? { nodeCount: list.length, boxes, frames } : { nodeCount: list.length, boxes };
};

const readStoredCanvas = async (id: string, root: string): Promise<unknown> => {
  const backend = await getCanvasBackend(root);
  if (backend) return backend.readCanvas(id);
  // v2 canvas.json is layout-only, so this skips every per-node file.
  const result = await readJsonWithRecovery(getCanvasJsonPath(id, root));
  if (result.kind === 'unrecoverable') throw result.err;
  return result.kind === 'ok' ? result.data : null;
};

export const readCanvasSummaries = async (
  ids: string[],
  root: string = STORE_DIR,
): Promise<Record<string, CanvasSummary | null>> => {
  const unique = [...new Set(ids)]
    .filter((id) => id !== MANIFEST_ID && isSafeNodeId(id))
    .slice(0, SUMMARY_ID_LIMIT);
  const entries = await Promise.all(unique.map(async (id) => {
    try {
      // A workspace that was never saved has no stored canvas: it is empty.
      const data = await readStoredCanvas(id, root);
      return [id, data ? summarizeCanvasData(data) : EMPTY_SUMMARY] as const;
    } catch {
      return [id, null] as const;
    }
  }));
  return Object.fromEntries(entries);
};

export const setupCanvasSummaryIpc = () => {
  ipcMain.handle('canvas:summaries', async (_event, payload: { ids?: unknown }) => {
    const ids = Array.isArray(payload?.ids)
      ? payload.ids.filter((id): id is string => typeof id === 'string')
      : [];
    try {
      return { ok: true, summaries: await readCanvasSummaries(ids) };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
};
