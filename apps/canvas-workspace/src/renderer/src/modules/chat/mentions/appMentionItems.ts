import type { AgentContextMcpAppSnapshot } from '../../../../../shared/agent-chat';
import type { MentionItem } from '../../../types';
import { globalMcpAppKey, globalMcpAppsStore } from '../../mcp-apps/global-apps';
import { parseAppMention } from '../components/utils/appMentions';
import { MENTION_RE } from '../components/utils/mentionMarkers';

export async function loadAppMentionItems(): Promise<MentionItem[]> {
  if (!globalMcpAppsStore.getSnapshot().loaded) await globalMcpAppsStore.refresh();
  return globalMcpAppsStore.getSnapshot().listings.map(app => ({
    type: 'app', app, label: app.title,
    description: `${app.serverName} · ${app.toolName}`,
  }));
}

/** Resolve saved markers too: draft restoration and editing may contain plain text. */
export function collectAppMentionContexts(text: string): AgentContextMcpAppSnapshot[] {
  const contexts: AgentContextMcpAppSnapshot[] = [];
  const seen = new Set<string>();
  const active = globalMcpAppsStore.readActiveContext();
  for (const match of text.matchAll(MENTION_RE)) {
    const ref = parseAppMention(match[1]);
    if (!ref) continue;
    const key = globalMcpAppKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    const listing = globalMcpAppsStore.find(ref);
    contexts.push(active && globalMcpAppKey(active) === key ? active : {
      ...ref, resourceUri: listing?.resourceUri ?? '', snapshots: [],
    });
  }
  return contexts;
}
