import { useEffect, useMemo, useState } from 'react';
import type { ArtifactSummary, CanvasNode } from '../../../../types';
import type { WorkspaceEntry } from '../../../../shared/workspaces';
import type { ReferenceEntry } from '../../../../shared/reference/types';
import { useAllWorkspaceNodeList } from '../../../workspace-nodes';
import { useI18n } from '../../../../i18n';
import { buildLibraryItems, filterLibraryItems, type LibraryKind } from './libraryModel';

interface Input {
  open: boolean; activeWorkspaceId: string; workspaces: WorkspaceEntry[];
  nodes: CanvasNode[]; references: ReferenceEntry[];
}
export const useLibraryCatalog = ({ open, activeWorkspaceId, workspaces, nodes, references }: Input) => {
  const { t } = useI18n();
  const [source, setSource] = useState('current');
  const [kind, setKind] = useState<LibraryKind>('all');
  const [query, setQuery] = useState('');
  const scopeId = source === 'all' ? null : source === 'current' ? activeWorkspaceId : source.slice(10);
  const scopes = useMemo(() => open ? workspaces.filter(w => !scopeId || w.id === scopeId) : [], [open, workspaces, scopeId]);
  const list = useAllWorkspaceNodeList(scopes);
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [artifactsLoading, setArtifactsLoading] = useState(false);
  useEffect(() => {
    if (source.startsWith('workspace:') && !workspaces.some(w => w.id === scopeId)) setSource('current');
  }, [source, scopeId, workspaces]);
  useEffect(() => {
    if (!open || !window.canvasWorkspace?.artifacts?.listAll) return;
    let cancelled = false, sequence = 0;
    const refresh = async () => {
      const request = ++sequence;
      setArtifactsLoading(true);
      try {
        const result = await window.canvasWorkspace.artifacts.listAll();
        if (cancelled || request !== sequence) return;
        if (!result.ok) throw new Error(result.error || t('reference.libraryLoadFailed'));
        setArtifacts(result.artifacts || []); setArtifactError(null);
      } catch (error) {
        if (!cancelled && request === sequence) setArtifactError(error instanceof Error ? error.message : String(error));
      } finally { if (!cancelled && request === sequence) setArtifactsLoading(false); }
    };
    void refresh();
    const unsubscribe = window.canvasWorkspace.artifacts.onChange?.(() => { void refresh(); });
    return () => { cancelled = true; unsubscribe?.(); };
  }, [open, t]);
  const items = useMemo(() => buildLibraryItems(list.nodes, nodes, references, artifacts, activeWorkspaceId), [list.nodes, nodes, references, artifacts, activeWorkspaceId]);
  const filtered = useMemo(() => filterLibraryItems(items, scopeId, kind, query), [items, scopeId, kind, query]);
  return { items, filtered, source, setSource, kind, setKind, query, setQuery,
    loading: open && (list.loading || artifactsLoading), error: list.error || artifactError,
    browseKey: `${activeWorkspaceId}|${source}|${kind}|${query}` };
};
