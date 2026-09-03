import { useEffect, useState } from 'react';
import { parseRoleMentions } from '../../../../shared/agent-roles';
import type { MentionItem } from '../../types';

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
/** name → color, for the plain-text `@Name` an agent writes when handing off. */
let roleNameColors: ReadonlyMap<string, string> = new Map();
/** Ids of externally-driven roles (local coding-agent CLIs) from the last load. */
let externalRoleIds: ReadonlySet<string> = new Set();
const colorListeners = new Set<() => void>();

function publishRoleColors(items: MentionItem[]): void {
  const next = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const item of items) {
    if (item.roleId && item.roleColor) next.set(item.roleId, item.roleColor);
    if (item.label && item.roleColor) byName.set(item.label, item.roleColor);
  }
  const changed = next.size !== roleColors.size
    || [...next].some(([id, color]) => roleColors.get(id) !== color)
    || byName.size !== roleNameColors.size
    || [...byName].some(([name, color]) => roleNameColors.get(name) !== color);
  if (!changed) return;
  roleColors = next;
  roleNameColors = byName;
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
      externalRoleIds = new Set(result.roles.filter(role => role.external).map(role => role.id));
    }
  } catch {
    items = [];
  }
  cache = { at: Date.now(), items };
  publishRoleColors(items);
  return items;
}

/**
 * True when the outgoing text @-mentions at least one role and EVERY
 * mentioned role is externally driven. Such a turn never touches the app's
 * model provider (the CLI brings its own auth), so the no-provider send
 * guard lets it through. Best-effort by design: an id the cache hasn't seen
 * counts as non-external (guard stays closed), and a persona pulled in
 * mid-turn via agent@agent handoff still fails visibly in its own segment.
 */
export function isExternalOnlyRoleMessage(text: string): boolean {
  const mentions = parseRoleMentions(text);
  if (mentions.length === 0) return false;
  return mentions.every(mention => externalRoleIds.has(mention.roleId));
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

export function getRoleNameColors(): ReadonlyMap<string, string> {
  return roleNameColors;
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

/**
 * name → accent color. Agents hand off by writing plain `@RoleName` (they
 * never emit internal markers), so the transcript needs name lookup to chip
 * those mentions.
 */
export function useRoleNameColors(): ReadonlyMap<string, string> {
  const [colors, setColors] = useState(roleNameColors);
  useEffect(() => {
    const unsubscribe = subscribeRoleColors(() => setColors(roleNameColors));
    void loadRoleMentionItems().then(() => setColors(roleNameColors));
    return unsubscribe;
  }, []);
  return colors;
}
