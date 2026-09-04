import { useCallback, useRef } from 'react';
import type {
  AgentContextTabRef,
  AgentScope,
  CanvasNode,
  MentionItem,
  WorkspaceOption,
} from '../../../../types';
import { useI18n, type I18nKey } from '../../../../i18n';
import { MENTION_MAX_ITEMS, sortAndCapMentionItems } from '../ChatMentionPopup/constants';
import { buildTabMentionItems } from '../utils/mentions';
import { flattenEntries } from '../../mentions/fileMentionItems';
import { loadRoleMentionItems } from '../../mentions/roleMentionItems';
import { buildStaticMentionItems } from '../../mentions/staticMentionItems';
import { loadInstalledPluginMentionItems } from '../../mentions/pluginMentionItems';

const tabKindLabelKey = (kind: AgentContextTabRef['kind']): I18nKey => {
  switch (kind) {
    case 'link': return 'chat.tabKind.link';
    case 'artifact': return 'chat.tabKind.artifact';
    case 'node-detail': return 'chat.tabKind.nodeDetail';
    case 'canvas': return 'chat.tabKind.canvas';
    case 'terminal': return 'chat.tabKind.terminal';
  }
};

interface Options {
  agentScope: AgentScope;
  allWorkspaces?: WorkspaceOption[];
  dockTabs?: AgentContextTabRef[];
  knowledgeNodes?: Array<{ id: string; title: string; type: CanvasNode['type']; workspaceId?: string }>;
  knowledgeTags?: Array<{ id: string; name: string; workspaceIds?: string[] }>;
  nodes?: CanvasNode[];
  rootFolder?: string;
  scopeId: string;
  workspaceId?: string;
}

export const useMentionItems = ({
  agentScope,
  allWorkspaces,
  dockTabs,
  knowledgeNodes,
  knowledgeTags,
  nodes,
  rootFolder,
  scopeId,
  workspaceId,
}: Options) => {
  const { t } = useI18n();
  const filesCacheRef = useRef(new Map<string, MentionItem[]>());
  const skillsCacheRef = useRef(new Map<string, MentionItem[]>());

  const describeTab = useCallback((tab: AgentContextTabRef): string => {
    const type = t(tabKindLabelKey(tab.kind));
    const owningWorkspaceId = tab.workspaceId ?? tab.dockWorkspaceId;
    const workspace = owningWorkspaceId
      ? allWorkspaces?.find(item => item.id === owningWorkspaceId)?.name ?? owningWorkspaceId
      : undefined;
    const description = workspace
      ? t('chat.tabMention.description', { type, workspace })
      : type;
    return tab.isActive
      ? t('chat.tabMention.current', { description })
      : description;
  }, [allWorkspaces, t]);

  const loadSkillItems = useCallback(async (): Promise<MentionItem[]> => {
    const cached = skillsCacheRef.current.get(scopeId);
    if (cached) return cached;
    try {
      const result = await window.canvasWorkspace.agent.listSkills({ scope: agentScope });
      const items: MentionItem[] = result.ok && result.skills
        ? result.skills.map(skill => ({ type: 'skill', label: skill.name, description: skill.description }))
        : [];
      skillsCacheRef.current.set(scopeId, items);
    } catch {
      skillsCacheRef.current.set(scopeId, []);
    }
    return skillsCacheRef.current.get(scopeId) ?? [];
  }, [agentScope, scopeId]);

  const buildMentionItems = useCallback(async (query: string, trigger: '@' | '/') => {
    if (trigger === '/') {
      const skills = await loadSkillItems();
      const normalized = query.toLowerCase();
      const filtered = normalized
        ? skills.filter(item => item.label.toLowerCase().includes(normalized)
          || item.description?.toLowerCase().includes(normalized))
        : skills;
      return filtered.slice(0, MENTION_MAX_ITEMS);
    }

    const items: MentionItem[] = [
      ...await loadRoleMentionItems(),
      ...await loadInstalledPluginMentionItems(),
    ];
    if (dockTabs) items.push(...buildTabMentionItems(dockTabs, describeTab));
    items.push(...buildStaticMentionItems({
      allWorkspaces,
      workspaceId,
      nodes,
      knowledgeNodes,
      knowledgeTags,
    }));

    if (workspaceId && rootFolder) {
      const cacheKey = `${scopeId}:${rootFolder}`;
      if (!filesCacheRef.current.has(cacheKey)) {
        try {
          const result = await window.canvasWorkspace.file.listDir(rootFolder, 2);
          filesCacheRef.current.set(cacheKey, result.ok && result.entries
            ? flattenEntries(result.entries, rootFolder)
            : []);
        } catch {
          filesCacheRef.current.set(cacheKey, []);
        }
      }
      items.push(...(filesCacheRef.current.get(cacheKey) ?? []));
    }

    const normalizedQuery = query.toLowerCase();
    const filtered = normalizedQuery
      ? items.filter(item => item.label.toLowerCase().includes(normalizedQuery)
        || item.description?.toLowerCase().includes(normalizedQuery))
      : items;
    if (normalizedQuery) {
      try {
        const result = await window.canvasWorkspace.agent.searchSessions(query, 5);
        if (result.ok && result.hits) {
          for (const hit of result.hits) {
            filtered.push({
              type: 'session',
              label: hit.preview || hit.date,
              sessionId: hit.sessionId,
              workspaceId: hit.workspaceId,
              description: `${hit.workspaceName} · ${hit.date}`,
            });
          }
        }
      } catch {
        // Session search is additive.
      }
    }
    return sortAndCapMentionItems(filtered);
  }, [allWorkspaces, describeTab, dockTabs, knowledgeNodes, knowledgeTags, loadSkillItems, nodes, rootFolder, scopeId, workspaceId]);

  return { buildMentionItems, describeTab };
};
