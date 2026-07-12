import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import type {
  AgentContextCanvasRef,
  AgentContextNodeRef,
  AgentContextTagRef,
  KnowledgeNodeSelection,
  WorkspaceNodeListItem,
} from '../../types';
import { RefreshIcon, SparklesIcon } from '../icons';
import { Button } from '../ui/Button';
import { KnowledgeNodeCard } from './KnowledgeNodeCard';
import { NodeFilters } from './NodeFilters';
import { NodeDetailDrawer } from './NodeDetailDrawer';
import { useAllWorkspaceNodeList } from './useWorkspaceNodes';
import {
  type NodeTypeFilter,
  formatTime,
  getNodeTags,
  getNodeTitle,
  getNodeTypeLabel,
  getNodeWorkspaceId,
  isKnowledgeNodeType,
  matchesSearch,
  tagName,
} from './utils';
import { useI18n } from '../../i18n';
import type { NodesAiContext } from './knowledgeAiContext';
import './index.css';
import './NodeCards.css';

interface NodesPageProps {
  workspaces: WorkspaceEntry[];
  selectedNode?: KnowledgeNodeSelection | null;
  onOpenNode: (workspaceId: string, nodeId: string) => void;
  onSelectNode?: (selection: KnowledgeNodeSelection | null) => void;
  onAskAi?: (context: NodesAiContext, action: 'chat' | 'summarize') => void;
}

const NODES_PAGE_SIZE = 30;

function filterByType(node: WorkspaceNodeListItem, type: NodeTypeFilter): boolean {
  if (type === 'all') return true;
  if (type === 'untagged') return getNodeTags(node).length === 0;
  return node.type === type;
}

export const NodesPage = ({
  workspaces,
  selectedNode,
  onOpenNode,
  onSelectNode,
  onAskAi,
}: NodesPageProps) => {
  const { language, t } = useI18n();
  const dateLocale = language === 'zh' ? 'zh-CN' : 'en-US';
  const { nodes, tags: tagDefinitions, loading, error, reload } = useAllWorkspaceNodeList(workspaces);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<NodeTypeFilter>('all');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<Set<string> | null>(null);
  const [aiSelection, setAiSelection] = useState<Set<string>>(() => new Set());
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null);
  const hadSelectedNodeRef = useRef(false);

  useEffect(() => {
    if (hadSelectedNodeRef.current && !selectedNode) {
      requestAnimationFrame(() => detailTriggerRef.current?.focus());
    }
    hadSelectedNodeRef.current = !!selectedNode;
  }, [selectedNode]);

  const activeWorkspaceIds = useMemo(() => {
    if (selectedWorkspaceIds === null) return new Set(workspaces.map((ws) => ws.id));
    return selectedWorkspaceIds;
  }, [selectedWorkspaceIds, workspaces]);

  const toggleWorkspace = (workspaceId: string) => {
    setSelectedWorkspaceIds((prev) => {
      const current = new Set(prev ?? workspaces.map((ws) => ws.id));
      if (current.has(workspaceId)) current.delete(workspaceId);
      else current.add(workspaceId);
      if (current.size === workspaces.length && workspaces.every((workspace) => current.has(workspace.id))) {
        return null;
      }
      return current;
    });
  };

  const workspaceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of nodes) {
      const wsId = getNodeWorkspaceId(node);
      counts.set(wsId, (counts.get(wsId) ?? 0) + 1);
    }
    return counts;
  }, [nodes]);

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of nodes) {
      for (const tag of getNodeTags(node)) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [nodes]);

  const filteredNodes = useMemo(() => {
    return nodes.filter((node) => {
      if (!activeWorkspaceIds.has(getNodeWorkspaceId(node))) return false;
      if (!matchesSearch(node, query)) return false;
      if (!filterByType(node, typeFilter)) return false;
      if (tagFilter && !getNodeTags(node).includes(tagFilter)) return false;
      return true;
    });
  }, [nodes, query, typeFilter, tagFilter, activeWorkspaceIds]);

  const nodeKey = (node: WorkspaceNodeListItem) => `${getNodeWorkspaceId(node)}:${node.id}`;
  const contextRef = (node: WorkspaceNodeListItem): AgentContextNodeRef | null => {
    if (!isKnowledgeNodeType(node.type)) return null;
    const workspaceId = getNodeWorkspaceId(node);
    if (!workspaceId) return null;
    return {
      id: node.id,
      title: getNodeTitle(node, t('workspaceNodes.untitled')),
      type: node.type,
      workspaceId,
    };
  };
  const selectedAiNodes = useMemo(() => nodes
    .filter((node) => aiSelection.has(nodeKey(node)))
    .map(contextRef)
    .filter((node): node is AgentContextNodeRef => node !== null), [aiSelection, nodes, t]);

  const aiScope = useMemo<NodesAiContext | null>(() => {
    const hasFilterIntent = query.trim().length > 0
      || selectedWorkspaceIds !== null
      || typeFilter !== 'all'
      || tagFilter !== null;
    if (!onAskAi || !hasFilterIntent || filteredNodes.length === 0) return null;

    const nodeRefs = filteredNodes
      .map(contextRef)
      .filter((node): node is AgentContextNodeRef => node !== null);
    // A bounded result set is exact, so it can travel to the existing @
    // context untouched. Larger result sets retain only explicit, durable
    // scopes, never an invisible or lossy bulk selection.
    if (nodeRefs.length > 0 && nodeRefs.length <= 12) return { nodes: nodeRefs };
    if (query.trim().length > 0 || typeFilter !== 'all') return null;

    const canvases = selectedWorkspaceIds === null
      ? []
      : workspaces
        .filter((workspace) => activeWorkspaceIds.has(workspace.id))
        .map((workspace): AgentContextCanvasRef => ({ id: workspace.id, name: workspace.name }));
    const tagsForScope = tagFilter
      ? [{ name: tagLabel(tagFilter), workspaceIds: Array.from(activeWorkspaceIds) } satisfies AgentContextTagRef]
      : [];
    return canvases.length > 0 || tagsForScope.length > 0
      ? { nodes: [], ...(tagsForScope.length > 0 ? { tags: tagsForScope } : {}), ...(canvases.length > 0 ? { canvases } : {}) }
      : null;
  }, [activeWorkspaceIds, filteredNodes, onAskAi, query, selectedWorkspaceIds, t, tagFilter, typeFilter, workspaces]);

  useEffect(() => {
    const available = new Set(nodes.map(nodeKey));
    setAiSelection((current) => {
      const next = new Set(Array.from(current).filter((key) => available.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [nodes]);

  const toggleAiSelection = (node: WorkspaceNodeListItem) => {
    const key = nodeKey(node);
    setAiSelection((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const [visibleCount, setVisibleCount] = useState(NODES_PAGE_SIZE);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Reset pagination/scroll only when the user changes a filter — NOT on
  // every `filteredNodes` identity change. Background reloads (live
  // workspace-node change events, drawer edits) rebuild the array each time
  // and would otherwise yank the list back to the top mid-browse.
  useEffect(() => {
    setVisibleCount(NODES_PAGE_SIZE);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [query, typeFilter, tagFilter, activeWorkspaceIds]);

  const visibleNodes = useMemo(
    () => filteredNodes.slice(0, visibleCount),
    [filteredNodes, visibleCount],
  );
  const hasMore = visibleCount < filteredNodes.length;

  useEffect(() => {
    if (!hasMore) return;
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((current) => current + NODES_PAGE_SIZE);
        }
      },
      { root, rootMargin: '600px 0px' },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [hasMore, filteredNodes.length]);

  const tagLabel = (tagId: string) => tagName(tagId, tagDefinitions);

  return (
    <main className="workspace-nodes-page">
      <section className="workspace-nodes-page__main">
        <div className="workspace-nodes-page__top">
          <header className="workspace-nodes-page__header">
            <div>
              <h1>{t('workspaceNodes.nodes.title')}</h1>
              <p>{t('workspaceNodes.nodes.subtitle', { count: nodes.length })}</p>
            </div>
            <div className="workspace-nodes-page__header-actions">
              <Button size="sm" onClick={() => void reload()}>
                <RefreshIcon size={14} />
                {t('workspaceNodes.refresh')}
              </Button>
            </div>
          </header>

          <NodeFilters
            query={query}
            onQueryChange={setQuery}
            workspaces={workspaces.map((workspace) => ({
              id: workspace.id,
              label: workspace.name,
              count: workspaceCounts.get(workspace.id) ?? 0,
            }))}
            activeWorkspaceIds={activeWorkspaceIds}
            selectedWorkspaceIds={selectedWorkspaceIds}
            onToggleWorkspace={toggleWorkspace}
            onResetWorkspaces={() => setSelectedWorkspaceIds(null)}
            typeFilter={typeFilter}
            onTypeFilterChange={setTypeFilter}
            tags={tags.map(([tag, count]) => ({
              id: tag,
              label: tagLabel(tag),
              count,
              description: tagDefinitions.find((item) => item.id === tag)?.description,
            }))}
            tagFilter={tagFilter}
            onTagFilterChange={setTagFilter}
            aiScopeLabel={aiScope
              ? aiScope.nodes.length > 0
                ? t('workspaceNodes.scope.askAi', { count: aiScope.nodes.length })
                : t('workspaceNodes.scope.askAiScope')
              : undefined}
            onAskAiAboutScope={aiScope ? () => onAskAi?.(aiScope, 'chat') : undefined}
          />
        </div>

        <div className="workspace-nodes-page__scroll" ref={scrollRef}>
          {error && <div className="workspace-nodes-state workspace-nodes-state--error">{error}</div>}
          {loading && <div className="workspace-nodes-state">{t('workspaceNodes.loadingNodes')}</div>}
          {!loading && filteredNodes.length === 0 && (
            <div className="workspace-nodes-empty">
              <h2>{t('workspaceNodes.emptyTitle')}</h2>
              <p>{t('workspaceNodes.emptyDescription')}</p>
            </div>
          )}
          <div className="workspace-node-grid">
            {visibleNodes.map((node) => {
              const tagsForNode = getNodeTags(node);
              const workspaceIdForNode = getNodeWorkspaceId(node);
              const selected = selectedNode?.workspaceId === workspaceIdForNode && selectedNode.nodeId === node.id;
              const title = getNodeTitle(node, t('workspaceNodes.untitled'));
              const contextLabel = node.workspaceName ?? workspaceIdForNode;
              const eligibleForAi = isKnowledgeNodeType(node.type);
              const nodeContext = contextRef(node);
              return (
                <KnowledgeNodeCard
                  key={`${workspaceIdForNode}:${node.id}`}
                  node={node}
                  title={title}
                  typeLabel={getNodeTypeLabel(node.type, t, t('workspaceNodes.genericNode'))}
                  updatedLabel={formatTime(node.updatedAt, t('workspaceNodes.noTimestamp'), dateLocale)}
                  tagLabels={tagsForNode.map(tagLabel)}
                  contextLabel={contextLabel}
                  emptyPreviewLabel={t('workspaceNodes.noPreview')}
                  aiSummaryLabel={t('workspaceNodes.aiSummary')}
                  aiSummaryConfirmedLabel={t('workspaceNodes.aiSummaryConfirmed')}
                  aiSummarizeLabel={t('workspaceNodes.aiSummarize')}
                  aiChatLabel={t('workspaceNodes.aiChat')}
                  selectForAiLabel={t('workspaceNodes.selectForAi')}
                  deselectForAiLabel={t('workspaceNodes.deselectForAi')}
                  openLabel={t('workspaceNodes.openSidePeek', { title })}
                  selected={selected}
                  contextSelected={aiSelection.has(nodeKey(node))}
                  onOpen={(trigger) => {
                    detailTriggerRef.current = trigger;
                    onSelectNode?.({ workspaceId: workspaceIdForNode, nodeId: node.id });
                  }}
                  onToggleContextSelection={eligibleForAi && onAskAi ? () => toggleAiSelection(node) : undefined}
                  onAskAi={nodeContext && onAskAi ? () => onAskAi({ nodes: [nodeContext] }, 'chat') : undefined}
                  onSummarize={nodeContext && onAskAi ? () => onAskAi({ nodes: [nodeContext] }, 'summarize') : undefined}
                />
              );
            })}
          </div>
          {hasMore && (
            <div ref={sentinelRef} className="workspace-nodes-sentinel" aria-hidden="true" />
          )}
        </div>

        {onAskAi && selectedAiNodes.length > 0 && (
          <div className="workspace-nodes-selection-bar" role="toolbar" aria-label={t('workspaceNodes.selection.count', { count: selectedAiNodes.length })}>
            <span className="workspace-nodes-selection-bar__count">{t('workspaceNodes.selection.count', { count: selectedAiNodes.length })}</span>
            <Button size="sm" variant="primary" onClick={() => onAskAi?.({ nodes: selectedAiNodes }, 'chat')}>
              <SparklesIcon size={13} />
              {t('workspaceNodes.selection.askAi')}
            </Button>
            <Button size="sm" onClick={() => setAiSelection(new Set())}>
              {t('workspaceNodes.selection.clear')}
            </Button>
          </div>
        )}
      </section>

      <NodeDetailDrawer
        workspaceId={selectedNode?.workspaceId ?? ''}
        nodeId={selectedNode?.nodeId ?? null}
        tagDefinitions={tagDefinitions}
        onClose={() => onSelectNode?.(null)}
        onOpenPage={onOpenNode}
        onNodeChanged={() => { void reload(); }}
      />

    </main>
  );
};
