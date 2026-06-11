import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import type { WorkspaceNodeListItem } from '../../types';
import type { SettingsSection } from '../Settings';
import { NodeDetailDrawer } from './NodeDetailDrawer';
import { NodesChatDock, useNodesChatDock } from './NodesChatDock';
import { useAllWorkspaceNodeList } from './useWorkspaceNodes';
import {
  NODE_TYPE_FILTERS,
  type NodeTypeFilter,
  formatTime,
  getNodeSummary,
  getNodeTags,
  getNodeTitle,
  getNodeTypeLabel,
  getNodeWorkspaceId,
  matchesSearch,
  tagName,
  truncateText,
} from './utils';
import { useI18n } from '../../i18n';

interface NodesPageProps {
  workspaces: WorkspaceEntry[];
  selectedNode?: { workspaceId: string; nodeId: string } | null;
  onOpenNode: (workspaceId: string, nodeId: string) => void;
  onSelectNode?: (selection: { workspaceId: string; nodeId: string } | null) => void;
  /** When provided, docks the knowledge assistant into the page. */
  onOpenAppSettings?: (section: SettingsSection) => void;
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
  onOpenAppSettings,
}: NodesPageProps) => {
  const { language, t } = useI18n();
  const dateLocale = language === 'zh' ? 'zh-CN' : 'en-US';
  const { nodes, tags: tagDefinitions, loading, error, reload } = useAllWorkspaceNodeList(workspaces);
  const dock = useNodesChatDock();
  const showDock = Boolean(onOpenAppSettings);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<NodeTypeFilter>('all');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<Set<string> | null>(null);

  const activeWorkspaceIds = useMemo(() => {
    if (selectedWorkspaceIds === null) return new Set(workspaces.map((ws) => ws.id));
    return selectedWorkspaceIds;
  }, [selectedWorkspaceIds, workspaces]);

  const toggleWorkspace = (workspaceId: string) => {
    setSelectedWorkspaceIds((prev) => {
      const current = new Set(prev ?? workspaces.map((ws) => ws.id));
      if (current.has(workspaceId)) current.delete(workspaceId);
      else current.add(workspaceId);
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
    <main
      className={`workspace-nodes-page${showDock && dock.open ? ' has-chat-dock' : ''}`}
      style={showDock ? dock.rootStyle : undefined}
    >
      <section className="workspace-nodes-page__main">
        <div className="workspace-nodes-page__top">
          <header className="workspace-nodes-page__header">
            <div>
              <h1>{t('workspaceNodes.nodes.title')}</h1>
              <p>{t('workspaceNodes.nodes.subtitle', { count: nodes.length })}</p>
            </div>
            <div className="workspace-nodes-page__header-actions">
              <button className="workspace-node-button" onClick={() => void reload()}>{t('workspaceNodes.refresh')}</button>
            </div>
          </header>

          <div className="workspace-nodes-toolbar">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('workspaceNodes.searchPlaceholder')}
              className="workspace-nodes-search"
            />
            {workspaces.length > 1 && (
              <div className="workspace-nodes-filter-row">
                <button
                  className={`workspace-node-chip${selectedWorkspaceIds === null ? ' is-active' : ''}`}
                  onClick={() => setSelectedWorkspaceIds(null)}
                >
                  {t('workspaceNodes.allWorkspaces')}
                </button>
                {workspaces.map((ws) => {
                  const active = activeWorkspaceIds.has(ws.id);
                  const count = workspaceCounts.get(ws.id) ?? 0;
                  return (
                    <button
                      key={ws.id}
                      className={`workspace-node-chip${active ? ' is-active' : ''}`}
                      onClick={() => toggleWorkspace(ws.id)}
                    >
                      {ws.name}
                      <span className="workspace-node-chip-count">{count}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="workspace-nodes-filter-row">
              {NODE_TYPE_FILTERS.map((type) => (
                <button
                  key={type}
                  className={`workspace-node-chip${typeFilter === type ? ' is-active' : ''}`}
                  onClick={() => setTypeFilter(type)}
                >
                  {type === 'all'
                    ? t('workspaceNodes.filter.all')
                    : type === 'untagged'
                      ? t('workspaceNodes.filter.untagged')
                      : getNodeTypeLabel(type, t, t('workspaceNodes.genericNode'))}
                </button>
              ))}
            </div>
            {tags.length > 0 && (
              <div className="workspace-nodes-filter-row">
                <button
                  className={`workspace-node-chip${tagFilter === null ? ' is-active' : ''}`}
                  onClick={() => setTagFilter(null)}
                >
                  {t('workspaceNodes.allTags')}
                </button>
                {tags.map(([tag, count]) => (
                  <button
                    key={tag}
                    className={`workspace-node-chip${tagFilter === tag ? ' is-active' : ''}`}
                    onClick={() => setTagFilter(tag)}
                    title={tagDefinitions.find((item) => item.id === tag)?.description}
                  >
                    <span className="workspace-node-chip-dot" />
                    {tagLabel(tag)}
                    <span className="workspace-node-chip-count">{count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
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
              const summary = getNodeSummary(node);
              const workspaceIdForNode = getNodeWorkspaceId(node);
              const selected = selectedNode?.workspaceId === workspaceIdForNode && selectedNode.nodeId === node.id;
              return (
                <article
                  key={`${workspaceIdForNode}:${node.id}`}
                  className={`workspace-node-card${selected ? ' is-selected' : ''}`}
                  onClick={() => onSelectNode?.({ workspaceId: workspaceIdForNode, nodeId: node.id })}
                >
                  <div className="workspace-node-card__meta">
                    <span className="workspace-node-type-pill">{getNodeTypeLabel(node.type, t, t('workspaceNodes.genericNode'))}</span>
                    <span>{formatTime(node.updatedAt, t('workspaceNodes.noTimestamp'), dateLocale)}</span>
                  </div>
                  <h2 onClick={(event) => { event.stopPropagation(); onOpenNode(workspaceIdForNode, node.id); }}>{getNodeTitle(node, t('workspaceNodes.untitled'))}</h2>
                  <p>{summary ? truncateText(summary, 180) : t('workspaceNodes.noPreview')}</p>
                  <div className="workspace-node-tags">
                    {tagsForNode.length > 0
                      ? tagsForNode.slice(0, 4).map((tag) => <span key={tag} className="workspace-node-tag">{tagLabel(tag)}</span>)
                      : <span className="workspace-node-muted">{t('workspaceNodes.noTags')}</span>}
                  </div>
                  <div className="workspace-node-card__footer">
                    <span>{node.workspaceName ?? workspaceIdForNode}</span>
                    {node.linkCount > 0 && <span>{t('workspaceNodes.linkCount', { count: node.linkCount })}</span>}
                  </div>
                </article>
              );
            })}
          </div>
          {hasMore && (
            <div ref={sentinelRef} className="workspace-nodes-sentinel" aria-hidden="true" />
          )}
        </div>
      </section>

      <NodeDetailDrawer
        workspaceId={selectedNode?.workspaceId ?? ''}
        nodeId={selectedNode?.nodeId ?? null}
        tagDefinitions={tagDefinitions}
        onClose={() => onSelectNode?.(null)}
        onOpenPage={onOpenNode}
        onNodeChanged={() => { void reload(); }}
      />

      {showDock && onOpenAppSettings && (
        <NodesChatDock
          open={dock.open}
          width={dock.width}
          onOpen={dock.openDock}
          onClose={dock.closeDock}
          onBeginResize={dock.beginResize}
          workspaces={workspaces.map((ws) => ({ id: ws.id, name: ws.name }))}
          nodes={nodes}
          tags={tagDefinitions}
          onOpenAppSettings={onOpenAppSettings}
        />
      )}
    </main>
  );
};
