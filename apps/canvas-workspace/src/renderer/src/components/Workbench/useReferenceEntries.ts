import { useCallback, useEffect, useState } from 'react';
import type { CanvasNode } from '../../types';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import { getNodeDisplayLabel } from '../../utils/nodeLabel';
import type { ReferenceEntry } from '../ReferenceDrawer/types';

const EMPTY_REFERENCES: ReferenceEntry[] = [];

interface UseReferenceEntriesParams {
  activeWorkspaceId: string;
  allNodes: Record<string, CanvasNode[]>;
  workspaces: WorkspaceEntry[];
}

// Owns the reference drawer's pinned-entry state: the per-workspace entry
// lists, the active selection, and the drawer open flag. Entry mutations
// (pin/remove/clear/title sync) all live here so Workbench stays a wiring
// layer.
export const useReferenceEntries = ({
  activeWorkspaceId,
  allNodes,
  workspaces,
}: UseReferenceEntriesParams) => {
  const [referenceDrawerOpen, setReferenceDrawerOpen] = useState(false);
  const [referenceDrawerLoaded, setReferenceDrawerLoaded] = useState(false);
  const [referencesByWorkspace, setReferencesByWorkspace] = useState<Record<string, ReferenceEntry[]>>({});
  const [activeReferenceIdByWorkspace, setActiveReferenceIdByWorkspace] = useState<Record<string, string | undefined>>({});

  useEffect(() => { if (referenceDrawerOpen) setReferenceDrawerLoaded(true); }, [referenceDrawerOpen]);

  const references = referencesByWorkspace[activeWorkspaceId] ?? EMPTY_REFERENCES;
  const activeReferenceId = activeReferenceIdByWorkspace[activeWorkspaceId];
  const activeReference = activeReferenceId
    ? references.find((entry) => (entry.kind === 'url' ? entry.id : `${entry.workspaceId}:${entry.nodeId}`) === activeReferenceId)
    : undefined;
  const activeReferenceNode = activeReference && activeReference.kind === 'node'
    ? (allNodes[activeReference.workspaceId] ?? []).find((node) => node.id === activeReference.nodeId)
    : undefined;

  const removeReference = useCallback((referenceId: string) => {
    setReferencesByWorkspace((prev) => {
      const current = prev[activeWorkspaceId] ?? [];
      const next = current.filter((entry) => (entry.kind === 'url' ? entry.id : `${entry.workspaceId}:${entry.nodeId}`) !== referenceId);
      if (next.length === current.length) return prev;
      return { ...prev, [activeWorkspaceId]: next };
    });
    setActiveReferenceIdByWorkspace((prev) => {
      if (prev[activeWorkspaceId] !== referenceId) return prev;
      return { ...prev, [activeWorkspaceId]: undefined };
    });
  }, [activeWorkspaceId]);

  const clearAllReferences = useCallback(() => {
    setReferencesByWorkspace((prev) => {
      if (!prev[activeWorkspaceId]?.length) return prev;
      return { ...prev, [activeWorkspaceId]: [] };
    });
    setActiveReferenceIdByWorkspace((prev) => ({
      ...prev,
      [activeWorkspaceId]: undefined,
    }));
  }, [activeWorkspaceId]);

  const setActiveReference = useCallback((nodeId: string | undefined) => {
    setActiveReferenceIdByWorkspace((prev) => ({
      ...prev,
      [activeWorkspaceId]: nodeId,
    }));
  }, [activeWorkspaceId]);

  // Drop node entries whose source node no longer exists (once that
  // workspace's nodes are known); url entries always survive.
  useEffect(() => {
    const current = referencesByWorkspace[activeWorkspaceId];
    if (!current?.length) return;
    const knownByWorkspace = new Map<string, Set<string>>();
    for (const [workspaceId, snapshot] of Object.entries(allNodes)) {
      knownByWorkspace.set(workspaceId, new Set(snapshot.map((node) => node.id)));
    }
    const filtered = current.filter((entry) => (
      entry.kind === 'url'
      || knownByWorkspace.get(entry.workspaceId)?.has(entry.nodeId)
      || !Object.prototype.hasOwnProperty.call(allNodes, entry.workspaceId)
    ));
    if (filtered.length === current.length) return;
    setReferencesByWorkspace((prev) => ({ ...prev, [activeWorkspaceId]: filtered }));
    setActiveReferenceIdByWorkspace((prev) => {
      const currentActive = prev[activeWorkspaceId];
      if (currentActive && filtered.some((entry) => (entry.kind === 'url' ? entry.id : `${entry.workspaceId}:${entry.nodeId}`) === currentActive)) return prev;
      const nextActive = filtered[0] ? (filtered[0].kind === 'url' ? filtered[0].id : `${filtered[0].workspaceId}:${filtered[0].nodeId}`) : undefined;
      return { ...prev, [activeWorkspaceId]: nextActive };
    });
  }, [activeWorkspaceId, allNodes, referencesByWorkspace]);

  const pinReferenceNode = useCallback((workspaceId: string, nodeId: string, sourceNode?: CanvasNode) => {
    setReferencesByWorkspace((prev) => {
      const current = prev[activeWorkspaceId] ?? [];
      const exists = current.some((entry) => entry.kind === 'node' && entry.workspaceId === workspaceId && entry.nodeId === nodeId);
      if (exists) return prev;
      const workspace = workspaces.find((item) => item.id === workspaceId);
      const node = (allNodes[workspaceId] ?? []).find((item) => item.id === nodeId) ?? sourceNode;
      const entry: ReferenceEntry = {
        kind: 'node',
        workspaceId,
        nodeId,
        titleSnapshot: node ? getNodeDisplayLabel(node) : undefined,
        typeSnapshot: node?.type,
        workspaceNameSnapshot: workspace?.name,
      };
      return { ...prev, [activeWorkspaceId]: [...current, entry] };
    });
    setActiveReferenceIdByWorkspace((prev) => ({ ...prev, [activeWorkspaceId]: `${workspaceId}:${nodeId}` }));
    setReferenceDrawerOpen(true);
  }, [activeWorkspaceId, allNodes, workspaces]);

  const pinReferenceUrl = useCallback((url: string, title?: string) => {
    const id = `url:${url}`;
    setReferencesByWorkspace((prev) => {
      const current = prev[activeWorkspaceId] ?? [];
      const exists = current.some((entry) => 'kind' in entry && entry.kind === 'url' && entry.url === url);
      if (exists) return prev;
      const entry: ReferenceEntry = { kind: 'url', id, url, title };
      return { ...prev, [activeWorkspaceId]: [...current, entry] };
    });
    setActiveReferenceIdByWorkspace((prev) => ({ ...prev, [activeWorkspaceId]: id }));
    setReferenceDrawerOpen(true);
  }, [activeWorkspaceId]);

  // The read-only URL preview can't persist the guest's page title through
  // the node onUpdate path, so the preview forwards it and we write it back
  // onto the reference entry (its title is what the entry list row shows).
  const updateUrlReferenceTitle = useCallback((referenceId: string, title: string) => {
    setReferencesByWorkspace((prev) => {
      const current = prev[activeWorkspaceId] ?? [];
      let changed = false;
      const next = current.map((entry) => {
        if (entry.kind !== 'url' || entry.id !== referenceId || entry.title === title) return entry;
        changed = true;
        return { ...entry, title };
      });
      return changed ? { ...prev, [activeWorkspaceId]: next } : prev;
    });
  }, [activeWorkspaceId]);

  return {
    activeReference,
    activeReferenceNode,
    clearAllReferences,
    pinReferenceNode,
    pinReferenceUrl,
    referenceDrawerLoaded,
    referenceDrawerOpen,
    references,
    removeReference,
    setActiveReference,
    setReferenceDrawerOpen,
    updateUrlReferenceTitle,
  };
};
