import type { AgentContextPluginRef, AgentRequestContext } from '../../../types';
import type { MentionItem } from '../types';

const CACHE_TTL_MS = 5_000;
let cached: { expiresAt: number; items: MentionItem[] } | null = null;
let pending: Promise<MentionItem[]> | null = null;

async function readInstalledPluginMentionItems(): Promise<MentionItem[]> {
  try {
    const api = window.canvasWorkspace?.pluginMarket;
    if (!api) return [];
    const result = await api.list();
    if (!result.ok || !result.snapshot) return [];
    return result.snapshot.listings
      .filter(listing => listing.installState === 'installed' && !listing.error)
      .map(listing => ({
        type: 'plugin' as const,
        pluginId: listing.id,
        label: listing.name,
        description: listing.description,
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
  } catch {
    return [];
  }
}

export function loadInstalledPluginMentionItems(): Promise<MentionItem[]> {
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.items);
  if (!pending) {
    pending = readInstalledPluginMentionItems().then((items) => {
      cached = { expiresAt: Date.now() + CACHE_TTL_MS, items };
      return items;
    }).finally(() => {
      pending = null;
    });
  }
  return pending;
}

export function collectPluginRefsFromEditable(editable: HTMLElement): AgentContextPluginRef[] {
  const refs: AgentContextPluginRef[] = [];
  editable.querySelectorAll<HTMLElement>('[data-mention-kind="plugin"]').forEach((chip) => {
    const id = chip.dataset.pluginId?.trim();
    const name = chip.querySelector('.chat-mention-chip-label')?.textContent?.trim();
    if (id && name && !refs.some(ref => ref.id === id)) refs.push({ id, name });
  });
  return refs;
}

export function withCollectedPlugins(
  editable: HTMLElement,
  context: AgentRequestContext | undefined,
): AgentRequestContext | undefined {
  const collected = collectPluginRefsFromEditable(editable);
  if (collected.length === 0) return context;
  const plugins = [...(context?.plugins ?? [])];
  for (const plugin of collected) {
    if (!plugins.some(existing => existing.id === plugin.id)) plugins.push(plugin);
  }
  return { ...(context ?? {}), plugins };
}

export function resetPluginMentionItemsForTests(): void {
  cached = null;
  pending = null;
}
