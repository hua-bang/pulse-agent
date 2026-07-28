import { useEffect, useState } from 'react';
import type { MentionItem } from '../types';

/**
 * Renderer-side cache of the role library: `@` popup entries plus the
 * id → accent-color snapshot chip rendering reads. Module-level because the
 * library is global (one list for every chat scope and composer), so a
 * per-hook cache would only multiply identical IPC reads. The 5s TTL keeps
 * chat-tool edits surfacing quickly without a read per keystroke; Settings
 * save/delete calls `invalidateRoleMentionItems()` so recolors/renames
 * repaint immediately.
 */
let cache: { at: number; items: MentionItem[] } | null = null;
let pending: Promise<MentionItem[]> | null = null;

let roleColors: ReadonlyMap<string, string> = new Map();
const colorListeners = new Set<() => void>();

function publishRoleColors(items: MentionItem[]): void {
  const next = new Map<string, string>();
  for (const item of items) {
    if (item.roleId && item.roleColor) next.set(item.roleId, item.roleColor);
  }
  const changed = next.size !== roleColors.size
    || [...next].some(([id, color]) => roleColors.get(id) !== color);
  if (!changed) return;
  roleColors = next;
  colorListeners.forEach(listener => listener());
}

async function readRoleMentionItems(): Promise<MentionItem[]> {
  let items: MentionItem[] = [];
  try {
    const result = await window.canvasWorkspace.agentRoles.list();
    if (result.ok) {
      items = result.roles.map(role => ({
        type: 'role' as const,
        label: role.name,
        roleId: role.id,
        roleColor: role.color,
        description: `${role.external ? `[${role.external.family === 'claude-code' ? 'Claude Code' : 'Codex'}] ` : ''}${role.prompt.replace(/\s+/g, ' ').slice(0, 60)}`,
      }));
    }
  } catch {
    items = [];
  }
  cache = { at: Date.now(), items };
  publishRoleColors(items);
  return items;
}

export function loadRoleMentionItems(): Promise<MentionItem[]> {
  if (cache && Date.now() - cache.at < 5000) return Promise.resolve(cache.items);
  // Concurrent mounts (one per visible message) share one in-flight read.
  if (!pending) {
    pending = readRoleMentionItems().finally(() => { pending = null; });
  }
  return pending;
}

/** Drop the TTL cache and re-read so popup entries + chip colors reflect a Settings edit now. */
export function invalidateRoleMentionItems(): Promise<MentionItem[]> {
  cache = null;
  return loadRoleMentionItems();
}

export function getRoleColors(): ReadonlyMap<string, string> {
  return roleColors;
}

/** Notifies whenever the id → color snapshot actually changes; returns unsubscribe. */
export function subscribeRoleColors(listener: () => void): () => void {
  colorListeners.add(listener);
  return () => { colorListeners.delete(listener); };
}

/**
 * Live id → accent-color map for transcript role chips. Mount-time load goes
 * through the shared TTL cache; the snapshot's identity only changes when a
 * color actually changes, so the setState fan-out across messages is free.
 */
export function useRoleColors(): ReadonlyMap<string, string> {
  const [colors, setColors] = useState(roleColors);
  useEffect(() => {
    const unsubscribe = subscribeRoleColors(() => setColors(roleColors));
    void loadRoleMentionItems().then(() => setColors(roleColors));
    return unsubscribe;
  }, []);
  return colors;
}
