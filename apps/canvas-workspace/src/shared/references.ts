/**
 * Cross-process contract for the Library drawer's pinned reference entries.
 *
 * These are the entries shown in the drawer's Pinned section. They persist
 * per workspace in `~/.pulse-coder/canvas/<workspaceId>/references.json` so
 * a pinned context survives reload/restart (the entry list is the durable
 * part; live previews re-resolve from the referenced node/url on demand).
 */

import type { CanvasNode } from './canvas';

export interface NodeReferenceEntry {
  kind: 'node';
  workspaceId: string;
  nodeId: string;
  titleSnapshot?: string;
  typeSnapshot?: CanvasNode['type'];
  workspaceNameSnapshot?: string;
}

export interface UrlReferenceEntry {
  kind: 'url';
  id: string;
  url: string;
  title?: string;
  group?: string;
}

export type ReferenceEntry = NodeReferenceEntry | UrlReferenceEntry;

export interface ReferencesApi {
  /** Load the persisted pinned entries for a workspace. */
  list: (workspaceId: string) => Promise<{ ok: boolean; references?: ReferenceEntry[]; error?: string }>;
  /** Replace the persisted pinned entries for a workspace. */
  save: (
    workspaceId: string,
    references: ReferenceEntry[],
  ) => Promise<{ ok: boolean; error?: string }>;
}
