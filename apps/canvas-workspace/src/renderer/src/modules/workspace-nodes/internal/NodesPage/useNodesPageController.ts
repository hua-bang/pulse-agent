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
  type NodeTypeFilter,
  getNodeTags,
  getNodeWorkspaceId,
  tagName,
} from '../utils';
import {
  buildNodesAiScope,
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
  const { nodes, tags: tagDefinitions, loading, error, reload } = useAllWorkspaceNodeList(workspaces);
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

  const toggleWorkspace = useCallback((workspaceId: string) => {
    setSelectedWorkspaceIds((previous) => {
      const current = new Set(previous ?? workspaces.map((workspace) => workspace.id));
      if (current.has(workspaceId)) current.delete(workspaceId);
      else current.add(workspaceId);
      return current.size === workspaces.length
        && workspaces.every((workspace) => current.has(workspace.id))
        ? null
        : current;
    });
  }, [workspaces]);

  const workspaceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of nodes) {
      const workspaceId = getNodeWorkspaceId(node);
      counts.set(workspaceId, (counts.get(workspaceId) ?? 0) + 1);
    }
    return counts;
  }, [nodes]);

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of nodes) {
      for (const tag of getNodeTags(node)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([id, count]) => ({
        id,
        label: tagName(id, tagDefinitions),
        count,
        description: tagDefinitions.find((definition) => definition.id === id)?.description,
      }));
  }, [nodes, tagDefinitions]);

  const filteredNodes = useMemo(() => filterWorkspaceNodes(nodes, {
    activeWorkspaceIds,
    query,
    typeFilter,
    tagFilter,
  }), [activeWorkspaceIds, nodes, query, tagFilter, typeFilter]);

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
    activeWorkspaceIds,
    aiScope,
    clearAiSelection: () => setAiSelection(new Set()),
    dateLocale: language === 'zh' ? 'zh-CN' : 'en-US',
    error,
    filteredCount: filteredNodes.length,
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
    visibleNodes,
    workspaceOptions: workspaces.map((workspace) => ({
      id: workspace.id,
      label: workspace.name,
      count: workspaceCounts.get(workspace.id) ?? 0,
    })),
  };
};
