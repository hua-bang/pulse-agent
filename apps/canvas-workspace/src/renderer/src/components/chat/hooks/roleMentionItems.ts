import type { MentionItem } from '../types';

/**
 * Role entries for the `@` mention popup. Module-level short-TTL cache: the
 * role library is global (one list for every chat scope and composer), so a
 * per-hook cache would only multiply identical IPC reads. The 5s TTL keeps
 * Settings edits surfacing quickly without a read per keystroke.
 */
let cache: { at: number; items: MentionItem[] } | null = null;

export async function loadRoleMentionItems(): Promise<MentionItem[]> {
  if (cache && Date.now() - cache.at < 5000) return cache.items;
  let items: MentionItem[] = [];
  try {
    const result = await window.canvasWorkspace.agentRoles.list();
    if (result.ok) {
      items = result.roles.map(role => ({
        type: 'role' as const,
        label: role.name,
        roleId: role.id,
        roleColor: role.color,
        description: role.prompt.replace(/\s+/g, ' ').slice(0, 60),
      }));
    }
  } catch {
    items = [];
  }
  cache = { at: Date.now(), items };
  return items;
}
