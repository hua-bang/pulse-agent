import './index.css';
import { LibraryMindmapPreview } from '../LibraryMindmapPreview';
import { SearchIcon } from '../Icons';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { REFERENCE_DRAG_TYPE } from '../../../../../shared/reference/drag';
import { Button, EmptyState } from '../../../../../components/ui';
import { NodeTypeIcon } from '../../../../../components/icons';
import { toFileUrl } from '../../../../../utils/fileUrl';
import { useI18n } from '../../../../../i18n';
import { libraryWindow, LIBRARY_ROW_HEIGHT, type LibraryItem } from '../libraryModel';

interface Props {
  items: LibraryItem[];
  visible: boolean;
  browseKey: string;
  positions: Map<string, number>;
  returnedId?: string;
  workspaceNameById: Map<string, string>;
  onOpen: (item: LibraryItem) => void;
  loading: boolean;
  hasFilters?: boolean;
  onResetFilters?: () => void;
}

export const ReferenceEntryList = ({ items, visible, browseKey, positions, returnedId, workspaceNameById, onOpen, loading, hasFilters, onResetFilters }: Props) => {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: positions.get(browseKey) || 0, height: 520 });
  useLayoutEffect(() => {
    if (!visible || !root.current) return;
    const top = Math.min(positions.get(browseKey) || 0, Math.max(0, items.length * LIBRARY_ROW_HEIGHT - root.current.clientHeight));
    root.current.scrollTop = top;
    setViewport({ top, height: root.current.clientHeight || 520 });
  }, [visible, browseKey, positions, items.length]);
  useEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (el.clientHeight > 0) setViewport(value => ({ ...value, height: el.clientHeight }));
    });
    observer.observe(el); return () => observer.disconnect();
  }, []);
  const range = libraryWindow(items.length, viewport.top, viewport.height);
  useEffect(() => {
    if (!visible || !returnedId) return;
    const button = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[data-library-id]') || [])
      .find(el => el.dataset.libraryId === returnedId);
    button?.focus({ preventScroll: true });
  }, [visible, returnedId, range.start]);
  return (
    <div ref={root} className="library-card-list" hidden={!visible} role="list" aria-label={t('reference.libraryItems')}
      onScroll={event => {
        if (!visible) return;
        const top = event.currentTarget.scrollTop;
        positions.set(browseKey, top); setViewport(value => ({ ...value, top }));
      }}>
      {items.length === 0 ? <EmptyState className="library-empty-state"
        icon={<span className="library-empty-icon" aria-hidden="true"><SearchIcon /></span>}
        title={loading ? t('reference.libraryLoading') : t('reference.libraryEmpty')}
        description={loading ? undefined : t('reference.libraryEmptyHint')}
        action={!loading && hasFilters && onResetFilters ? <Button size="sm" onClick={onResetFilters}>{t('reference.libraryResetFilters')}</Button> : undefined} /> : <>
        <div style={{ height: range.before }} aria-hidden="true" />
        {items.slice(range.start, range.end).map((item, offset) => (
          <div key={item.id} role="listitem" aria-posinset={range.start + offset + 1} aria-setsize={items.length} className="library-card-row">
            <Button className={`library-card${returnedId === item.id ? ' library-card--returned' : ''}`}
              draggable={item.entry.kind === 'node'} onDragStart={event => {
                if (item.entry.kind !== 'node') { event.preventDefault(); return; }
                event.dataTransfer.effectAllowed = 'copy';
                event.dataTransfer.setData(REFERENCE_DRAG_TYPE, JSON.stringify(item.entry));
              }}
              data-library-id={item.id} onClick={() => onOpen(item)} aria-label={t('reference.libraryPreview', { title: item.title })}>
              <span className="library-card-heading"><NodeTypeIcon type={item.nodeType || 'iframe'} size={15} /><span>{item.title}</span></span>
              {item.kind === 'mindmap' ? <LibraryMindmapPreview item={item} /> : item.previewPath ? <img className="library-card-image" src={toFileUrl(item.previewPath)} alt="" loading="lazy" decoding="async" />
                : <span className="library-card-summary">{item.summary || t('reference.libraryPreviewHint')}</span>}
              <span className="library-card-meta"><span>{t(`reference.libraryKind.${item.kind}`)}</span><span>{workspaceNameById.get(item.workspaceId) || t('reference.artifactScopeGlobal')}</span></span>
            </Button>
          </div>
        ))}
        <div style={{ height: range.after }} aria-hidden="true" />
      </>}
    </div>
  );
};
