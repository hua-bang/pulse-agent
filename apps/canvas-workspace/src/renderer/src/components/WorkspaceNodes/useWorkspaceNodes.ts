import { useCallback, useEffect, useRef, useState } from 'react';
import type { KnowledgeTagDefinition, WorkspaceNodeListItem, WorkspaceNodeRecord } from '../../types';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import { isKnowledgeNodeType } from './utils';
import { useI18n } from '../../i18n';

export function useWorkspaceNodeList(workspaceId: string) {
  const { t } = useI18n();
  const [nodes, setNodes] = useState<WorkspaceNodeListItem[]>([]);
  const [tags, setTags] = useState<KnowledgeTagDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Live change events and manual refreshes can overlap; only the newest
  // reload may apply its results.
  const requestSeqRef = useRef(0);

  const reload = useCallback(async (options?: { background?: boolean }) => {
    const seq = ++requestSeqRef.current;
    const api = window.canvasWorkspace?.workspaceNodes;
    if (!api || !workspaceId) return;
    const background = options?.background === true;
    if (!background) setLoading(true);
    setError(null);
    try {
      const result = await api.list(workspaceId);
      if (seq !== requestSeqRef.current) return;
      if (!result.ok) {
        setError(result.error ?? t('workspaceNodes.loadNodesFailed'));
        setNodes([]);
        setTags([]);
        return;
      }
      setNodes(result.nodes ?? []);
      setTags(result.tags ?? []);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setNodes([]);
      setTags([]);
    } finally {
      if (!background && seq === requestSeqRef.current) setLoading(false);
    }
  }, [workspaceId, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Live-refresh when the main process reports a change touching this
  // workspace (e.g. the agent's canvas_tag_node).
  useEffect(() => {
    const api = window.canvasWorkspace?.workspaceNodes;
    if (!api?.onChange) return undefined;
    return api.onChange((event) => {
      if (!event.workspaceIds?.length || event.workspaceIds.includes(workspaceId)) {
        void reload({ background: true });
      }
    });
  }, [reload, workspaceId]);

  return { nodes, tags, loading, error, reload };
}

export function useAllWorkspaceNodeList(workspaces: WorkspaceEntry[]) {
  const { t } = useI18n();
  const [nodes, setNodes] = useState<WorkspaceNodeListItem[]>([]);
  const [tags, setTags] = useState<KnowledgeTagDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Live change events and manual refreshes can overlap; only the newest
  // reload may apply its results.
  const requestSeqRef = useRef(0);

  const reload = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    const api = window.canvasWorkspace?.workspaceNodes;
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all(
        workspaces.map(async (workspace) => {
          const result = await api.list(workspace.id);
          if (!result.ok) {
            throw new Error(result.error ?? t('workspaceNodes.loadWorkspaceNodesFailed', { workspaceName: workspace.name }));
          }
          return { workspace, result };
        }),
      );
      if (seq !== requestSeqRef.current) return;
      const tagMap = new Map<string, KnowledgeTagDefinition>();
      const nextNodes: WorkspaceNodeListItem[] = [];
      for (const { workspace, result } of results) {
        for (const tag of result.tags ?? []) tagMap.set(tag.id, tag);
        for (const node of result.nodes ?? []) {
          if (!isKnowledgeNodeType(node.type)) continue;
          nextNodes.push({
            ...node,
            workspaceId: workspace.id,
            workspaceName: workspace.name,
          });
        }
      }
      nextNodes.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || (a.title ?? a.id).localeCompare(b.title ?? b.id));
      setNodes(nextNodes);
      setTags(Array.from(tagMap.values()).sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setNodes([]);
      setTags([]);
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }, [workspaces, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Live-refresh when the main process reports a workspace-node change (e.g.
  // the agent's canvas_tag_node) so chat-applied tags appear in the graph
  // without a manual refresh.
  useEffect(() => {
    const api = window.canvasWorkspace?.workspaceNodes;
    if (!api?.onChange) return undefined;
    return api.onChange(() => {
      void reload();
    });
  }, [reload]);

  return { nodes, tags, loading, error, reload };
}

export function useWorkspaceNode(workspaceId: string, nodeId: string | null) {
  const { t } = useI18n();
  const [node, setNode] = useState<WorkspaceNodeRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Monotonic id of the latest read. Clicking node A then node B fires two
  // overlapping reads; if A's resolves last it must not clobber B's record.
  const requestSeqRef = useRef(0);

  const reload = useCallback(async (options?: { background?: boolean }) => {
    const seq = ++requestSeqRef.current;
    const api = window.canvasWorkspace?.workspaceNodes;
    if (!api || !workspaceId || !nodeId) {
      setNode(null);
      return;
    }
    const background = options?.background === true;
    if (!background) setLoading(true);
    setError(null);
    try {
      const result = await api.read(workspaceId, nodeId);
      if (seq !== requestSeqRef.current) return;
      if (!result.ok) {
        setError(result.error ?? t('workspaceNodes.loadNodeFailed'));
        setNode(null);
        return;
      }
      setNode(result.node ?? null);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setNode(null);
    } finally {
      if (!background && seq === requestSeqRef.current) setLoading(false);
    }
  }, [workspaceId, nodeId, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const api = window.canvasWorkspace?.workspaceNodes;
    if (!api?.onChange) return undefined;
    return api.onChange((event) => {
      if (!event.workspaceIds?.length || event.workspaceIds.includes(workspaceId)) {
        void reload({ background: true });
      }
    });
  }, [reload, workspaceId]);

  return { node, loading, error, reload, setNode };
}

export function useKnowledgeTags() {
  const { t } = useI18n();
  const [tags, setTags] = useState<KnowledgeTagDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const api = window.canvasWorkspace?.workspaceNodes;
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.tags();
      if (!result.ok) {
        setError(result.error ?? t('workspaceNodes.loadTagsFailed'));
        setTags([]);
        return;
      }
      setTags(result.tags ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setTags([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { tags, loading, error, reload };
}
