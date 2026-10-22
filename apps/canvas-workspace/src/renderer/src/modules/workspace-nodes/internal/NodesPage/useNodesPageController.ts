import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { WorkspaceEntry } from '../../../../shared/workspaces';
import type { WorkspaceNodeListItem } from '../../../../types';
import { useI18n } from '../../../../i18n';
import { useRightDockState } from '../../../../shared/dockPort';
import type { NodesAiContext } from '../knowledgeAiContext';
import { useAllWorkspaceNodeList } from '../useWorkspaceNodes';
import {
  NODE_TYPE_FILTERS,
  type NodeTypeFilter,
  UNTAGGED_TAG_FILTER,
  getNodeTags,
  getNodeTypeLabel,
  getNodeWorkspaceId,
  tagName,
} from '../utils';
import {
  buildNodesAiScope,
  countNodeFacets,
  filterWorkspaceNodes,
  nodeKey,
  reconcileNodeSelection,
  toAgentContextNodeRef,
} from './nodesPageModel';

const NODES_PAGE_SIZE = 30;

interface Input {
  workspaces: WorkspaceEntry[];
  aiEnabled: boolean;
}

export const useNodesPageController = ({ workspaces, aiEnabled }: Input) => {
  const { language, t } = useI18n();
  const dockState = useRightDockState();
  const {
    nodes: allNodes,
    tags: tagDefinitions,
    loading,
    error,
    reload,
  } = useAllWorkspaceNodeList(workspaces);
  // Records removed from every canvas stay in storage. Hide them here as the
  // Graph page does, so a deleted node does not linger in the list.
  const nodes = useMemo(
    () => allNodes.filter((node) => node.onCanvas !== false),
    [allNodes],
  );
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<NodeTypeFilter>('all');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<Set<string> | null>(null);
  const [aiSelection, setAiSelection] = useState<Set<string>>(() => new Set());
  const [visibleCount, setVisibleCount] = useState(NODES_PAGE_SIZE);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const untitled = t('workspaceNodes.untitled');

  const activeWorkspaceIds = useMemo(() => (
    selectedWorkspaceIds ?? new Set(workspaces.map((workspace) => workspace.id))
  ), [selectedWorkspaceIds, workspaces]);

  // From "all", a click narrows to that one workspace; later clicks add or
  // remove workspaces, and an empty or complete set returns to "all".
  const toggleWorkspace = useCallback((workspaceId: string) => {
    setSelectedWorkspaceIds((previous) => {
      if (previous === null) return new Set([workspaceId]);
      const current = new Set(previous);
      if (current.has(workspaceId)) current.delete(workspaceId);
      else current.add(workspaceId);
      return current.size === 0 || workspaces.every((workspace) => current.has(workspace.id))
        ? null
        : current;
    });
  }, [workspaces]);

  const filters = useMemo(() => ({
    activeWorkspaceIds,
    query,
    typeFilter,
    tagFilter,
  }), [activeWorkspaceIds, query, tagFilter, typeFilter]);

  const facets = useMemo(() => countNodeFacets(nodes, filters), [filters, nodes]);

  // Option lists come from all nodes so they stay put while filtering;
  // only their counts follow the other active filters.
  const typeOptions = useMemo(() => {
    const present = new Set(nodes.map((node) => node.type));
    return NODE_TYPE_FILTERS
      .filter((type) => type !== 'all' && (present.has(type) || type === typeFilter))
      .map((type) => ({
        id: type,
        label: getNodeTypeLabel(type, t, t('workspaceNodes.genericNode')),
        count: facets.types.get(type) ?? 0,
      }));
  }, [facets, nodes, t, typeFilter]);

  const tags = useMemo(() => {
    const totals = new Map<string, number>();
    let untagged = 0;
    for (const node of nodes) {
      const nodeTags = getNodeTags(node);
      if (nodeTags.length === 0) untagged += 1;
      for (const tag of nodeTags) totals.set(tag, (totals.get(tag) ?? 0) + 1);
    }
    const options = Array.from(totals.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([id]) => ({
        id,
        label: tagName(id, tagDefinitions),
        count: facets.tags.get(id) ?? 0,
        description: tagDefinitions.find((definition) => definition.id === id)?.description,
      }));
    if (untagged > 0 || tagFilter === UNTAGGED_TAG_FILTER) {
      options.push({
        id: UNTAGGED_TAG_FILTER,
        label: t('workspaceNodes.filter.untagged'),
        count: facets.tags.get(UNTAGGED_TAG_FILTER) ?? 0,
        description: undefined,
      });
    }
    return options;
  }, [facets, nodes, t, tagDefinitions, tagFilter]);

  const filteredNodes = useMemo(() => filterWorkspaceNodes(nodes, filters), [filters, nodes]);
  const hasActiveFilters = selectedWorkspaceIds !== null
    || typeFilter !== 'all'
    || tagFilter !== null;

  const clearFilters = useCallback(() => {
    setSelectedWorkspaceIds(null);
    setTypeFilter('all');
    setTagFilter(null);
  }, []);

  const aiScope = useMemo<NodesAiContext | null>(() => aiEnabled
    ? buildNodesAiScope({
        filteredNodes,
        workspaces,
        activeWorkspaceIds,
        selectedWorkspaceIds,
        query,
        typeFilter,
        tagFilter,
        tagDefinitions,
        untitled,
      })
    : null, [
    activeWorkspaceIds,
    aiEnabled,
    filteredNodes,
    query,
    selectedWorkspaceIds,
    tagDefinitions,
    tagFilter,
    typeFilter,
    untitled,
    workspaces,
  ]);

  useEffect(() => {
    setAiSelection((current) => reconcileNodeSelection(current, nodes));
  }, [nodes]);

  useEffect(() => {
    setVisibleCount(NODES_PAGE_SIZE);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [activeWorkspaceIds, query, tagFilter, typeFilter]);

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
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((current) => current + NODES_PAGE_SIZE);
        }
      },
      { root, rootMargin: '600px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [filteredNodes.length, hasMore]);

  const toggleAiSelection = useCallback((node: WorkspaceNodeListItem) => {
    const key = nodeKey(node);
    setAiSelection((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectedAiNodes = useMemo(() => nodes
    .filter((node) => aiSelection.has(nodeKey(node)))
    .map((node) => toAgentContextNodeRef(node, untitled))
    .filter((node) => node !== null), [aiSelection, nodes, untitled]);

  const isNodeSelected = useCallback((node: WorkspaceNodeListItem) => {
    const workspaceId = getNodeWorkspaceId(node);
    return dockState.tabs.some((tab) => (
      tab.id === dockState.activeTabId
      && tab.kind === 'node-detail'
      && tab.workspaceId === workspaceId
      && tab.nodeId === node.id
    ));
  }, [dockState.activeTabId, dockState.tabs]);

  return {
    aiScope,
    clearAiSelection: () => setAiSelection(new Set()),
    clearFilters,
    clearFiltersAndQuery: () => {
      clearFilters();
      setQuery('');
    },
    dateLocale: language === 'zh' ? 'zh-CN' : 'en-US',
    error,
    filteredCount: filteredNodes.length,
    hasActiveFilters,
    hasMore,
    isContextSelected: (node: WorkspaceNodeListItem) => aiSelection.has(nodeKey(node)),
    isNodeSelected,
    loading,
    nodeContext: (node: WorkspaceNodeListItem) => toAgentContextNodeRef(node, untitled),
    nodesCount: nodes.length,
    query,
    reload,
    resetWorkspaces: () => setSelectedWorkspaceIds(null),
    scrollRef,
    selectedAiNodes,
    selectedWorkspaceIds,
    sentinelRef,
    setQuery,
    setTagFilter,
    setTypeFilter,
    tagFilter,
    tagLabel: (tagId: string) => tagName(tagId, tagDefinitions),
    tags,
    toggleAiSelection,
    toggleWorkspace,
    typeFilter,
    typeOptions,
    typesAllCount: facets.typesAll,
    tagsAllCount: facets.tagsAll,
    visibleNodes,
    workspaceOptions: workspaces.map((workspace) => ({
      id: workspace.id,
      label: workspace.name,
      count: facets.workspaces.get(workspace.id) ?? 0,
    })),
    workspacesAllCount: facets.workspacesAll,
  };
};
