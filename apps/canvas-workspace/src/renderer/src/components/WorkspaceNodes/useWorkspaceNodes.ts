import { useCallback, useEffect, useState } from 'react';
import type { KnowledgeTagDefinition, WorkspaceNodeListItem, WorkspaceNodeRecord } from '../../types';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import { isKnowledgeNodeType } from './utils';

export function useWorkspaceNodeList(workspaceId: string) {
  const [nodes, setNodes] = useState<WorkspaceNodeListItem[]>([]);
  const [tags, setTags] = useState<KnowledgeTagDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const api = window.canvasWorkspace?.workspaceNodes;
    if (!api || !workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.list(workspaceId);
      if (!result.ok) {
        setError(result.error ?? 'Unable to load nodes.');
        setNodes([]);
        setTags([]);
        return;
      }
      setNodes(result.nodes ?? []);
      setTags(result.tags ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setNodes([]);
      setTags([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { nodes, tags, loading, error, reload };
}

export function useAllWorkspaceNodeList(workspaces: WorkspaceEntry[]) {
  const [nodes, setNodes] = useState<WorkspaceNodeListItem[]>([]);
  const [tags, setTags] = useState<KnowledgeTagDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const api = window.canvasWorkspace?.workspaceNodes;
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all(
        workspaces.map(async (workspace) => {
          const result = await api.list(workspace.id);
          if (!result.ok) {
            throw new Error(result.error ?? `Unable to load nodes for ${workspace.name}.`);
          }
          return { workspace, result };
        }),
      );
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
      setError(err instanceof Error ? err.message : String(err));
      setNodes([]);
      setTags([]);
    } finally {
      setLoading(false);
    }
  }, [workspaces]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { nodes, tags, loading, error, reload };
}

export function useWorkspaceNode(workspaceId: string, nodeId: string | null) {
  const [node, setNode] = useState<WorkspaceNodeRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const api = window.canvasWorkspace?.workspaceNodes;
    if (!api || !workspaceId || !nodeId) {
      setNode(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await api.read(workspaceId, nodeId);
      if (!result.ok) {
        setError(result.error ?? 'Unable to load node.');
        setNode(null);
        return;
      }
      setNode(result.node ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setNode(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, nodeId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { node, loading, error, reload, setNode };
}

export function useKnowledgeTags() {
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
        setError(result.error ?? 'Unable to load tags.');
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
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { tags, loading, error, reload };
}
