import { useCallback, useEffect, useRef, useState } from 'react';
import type { CanvasNode } from '../../../../types';
import type { ReferenceEntry } from '../../../../shared/reference/types';
import { getReferenceId } from '../../../../shared/reference/utils';
import { isReferenceableNodeType } from '../../../../utils/referenceNodes';
import { useI18n } from '../../../../i18n';
import type { LibraryItem } from './libraryModel';

export const useLibraryDetail = (workspaceId: string, external: ReferenceEntry | undefined,
  getLiveNode: (entry: ReferenceEntry) => CanvasNode | undefined, references: ReferenceEntry[]) => {
  const { t } = useI18n();
  const [active, setActive] = useState<ReferenceEntry | undefined>(external);
  const [detail, setDetail] = useState(!!external);
  const [trail, setTrail] = useState<LibraryItem[]>([]);
  const [visited, setVisited] = useState<ReferenceEntry[]>(external ? [external] : []);
  const [records, setRecords] = useState<Record<string, CanvasNode>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const previousExternal = useRef(external ? getReferenceId(external) : undefined);
  const previousWorkspace = useRef(workspaceId);
  const remember = useCallback((entry: ReferenceEntry) => {
    setVisited(entries => entries.some(e => getReferenceId(e) === getReferenceId(entry)) ? entries : [...entries, entry]);
  }, []);
  const externalId = external ? getReferenceId(external) : undefined;
  useEffect(() => {
    if (previousWorkspace.current !== workspaceId) {
      previousWorkspace.current = workspaceId; previousExternal.current = externalId;
      setActive(external); setDetail(!!external); setTrail([]); setVisited(external ? [external] : []); setRecords({});
    } else if (externalId !== previousExternal.current) {
      previousExternal.current = externalId;
      if (external) { setActive(external); setDetail(true); remember(external); }
    }
  }, [external, externalId, workspaceId, remember]);
  const activeId = active ? getReferenceId(active) : undefined;
  const live = active ? getLiveNode(active) : undefined;
  useEffect(() => {
    setError(null); setLoading(false);
    if (!active || active.kind !== 'node' || live) return;
    const api = window.canvasWorkspace?.workspaceNodes;
    if (!api) { setError(t('reference.sourceMissing')); return; }
    let cancelled = false, sequence = 0;
    const load = async (background = false) => {
      const request = ++sequence;
      if (!background) setLoading(true);
      try {
        const result = await api.read(active.workspaceId, active.nodeId);
        if (cancelled || request !== sequence) return;
        const record = result.node;
        if (!result.ok || !record || !isReferenceableNodeType(record.type as CanvasNode['type'])) {
          setError(result.error || t('reference.sourceMissing')); return;
        }
        const node: CanvasNode = { id: record.id, type: record.type as CanvasNode['type'], title: record.title || record.id,
          data: record.data as CanvasNode['data'], properties: record.properties, links: record.links,
          x: 0, y: 0, width: 440, height: 420, updatedAt: record.updatedAt };
        setRecords(all => ({ ...all, [getReferenceId(active)]: node })); setError(null);
      } catch (reason) { if (!cancelled && request === sequence) setError(String(reason)); }
      finally { if (!cancelled && request === sequence) setLoading(false); }
    };
    void load();
    const unsubscribe = api.onChange?.(event => {
      if (!event.workspaceIds.length || event.workspaceIds.includes(active.workspaceId)) void load(true);
    });
    return () => { cancelled = true; unsubscribe?.(); };
  }, [active, live, t, reload]);
  useEffect(() => {
    const ids = new Set(references.map(getReferenceId));
    setVisited(entries => {
      const next = entries.filter(entry => entry.kind !== 'url' || ids.has(entry.id));
      return next.length === entries.length ? entries : next;
    });
    if (active?.kind === 'url' && !ids.has(active.id)) { setActive(undefined); setDetail(false); }
  }, [references, active]);

  const open = useCallback((item: LibraryItem, list?: LibraryItem[]) => {
    if (list) setTrail(list);
    setActive(item.entry); remember(item.entry); setDetail(true); setReload(value => value + 1);
  }, [remember]);
  const index = trail.findIndex(item => item.id === activeId);
  return { active, activeId, detail, setDetail, open, trail, index, visited, loading, error, retry: () => setReload(value => value + 1),
    node: live || (activeId ? records[activeId] : undefined),
    getNode: (entry: ReferenceEntry) => getLiveNode(entry) || records[getReferenceId(entry)] };
};
