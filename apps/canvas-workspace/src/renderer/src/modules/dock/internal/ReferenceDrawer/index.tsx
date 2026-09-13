import './index.css';
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react';
import type { CanvasNode } from '../../../../types';
import type { WorkspaceEntry } from '../../../../shared/workspaces';
import type { NodeReferenceEntry, ReferenceEntry } from '../../../../shared/reference/types';
import { Button, EmptyState } from '../../../../components/ui';
import { useRightDock } from '../../../../shared/dockPort';
import { ReferenceDrawerToolbar } from './ReferenceDrawerToolbar';
import { ReferenceEntryList } from './ReferenceEntryList';
import { ReferenceUrlEditor } from './ReferenceUrlEditor';
import { useReferenceDrawerState } from './useReferenceDrawerState';
import { getReferenceId } from '../../../../shared/reference/utils';
import { useI18n } from '../../../../i18n';
import { useLibraryCatalog } from './useLibraryCatalog';
import { useLibraryDetail } from './useLibraryDetail';

const ReferencePreviewPanel = lazy(() => import('./ReferencePreviews').then(module => ({ default: module.ReferencePreviewPanel })));

interface ReferenceDrawerProps {
  open: boolean;
  activeWorkspaceId: string;
  workspaces: WorkspaceEntry[];
  references: ReferenceEntry[];
  activeReference?: ReferenceEntry;
  activeReferenceNode?: CanvasNode;
  nodes: CanvasNode[];
  allNodes: Record<string, CanvasNode[]>;
  selectedNode?: CanvasNode;
  onOpenChange: (open: boolean) => void;
  onSelectReference: (referenceId: string | undefined) => void;
  onRemoveReference: (referenceId: string) => void;
  onClearAll: () => void;
  onAddReference: (workspaceId: string, nodeId: string) => void;
  onAddUrlReference: (url: string, title?: string) => void;
  onAddArtifactReference: (artifact: { workspaceId: string; artifactId: string; title?: string; type?: 'html' | 'svg' | 'mermaid' }) => void;
  onUrlReferenceTitle?: (referenceId: string, title: string) => void;
  onFocusNode: (workspaceId: string, nodeId: string) => void;
  onAddReferenceToCanvas: (entry: NodeReferenceEntry) => void;
  onWorkspaceNodesRequest: (workspaceId: string) => void;
}


export const ReferenceDrawer = (props: ReferenceDrawerProps) => <LibraryDrawer key={props.activeWorkspaceId} {...props} />;

const LibraryDrawer = ({
  open, activeWorkspaceId, workspaces, references, activeReference,
  nodes, allNodes, onOpenChange, onRemoveReference, onClearAll,
  onAddReference, onAddUrlReference, onUrlReferenceTitle,
  onFocusNode, onAddReferenceToCanvas, onWorkspaceNodesRequest,
}: ReferenceDrawerProps) => {
  const { t } = useI18n();
  const dock = useRightDock();
  const state = useReferenceDrawerState({ open, activeWorkspaceId, workspaces, references,
    nodes, allNodes, onAddReference, onAddUrlReference, onWorkspaceNodesRequest });
  const catalog = useLibraryCatalog({ open, activeWorkspaceId, workspaces, nodes, references });
  const getLiveNode = useCallback((entry: ReferenceEntry) => entry.kind === 'node' ? state.getNodeByEntry(entry) : undefined, [state.getNodeByEntry]);
  const detail = useLibraryDetail(activeWorkspaceId, activeReference, getLiveNode, references);
  const positions = useRef(new Map<string, number>());
  const backButton = useRef<HTMLButtonElement>(null);
  const [returnedId, setReturnedId] = useState<string>();
  const [actionError, setActionError] = useState<string | null>(null);
  const [pinning, setPinning] = useState(false);
  const previewEntries = useMemo(() => {
    const map = new Map(references.map(entry => [getReferenceId(entry), entry]));
    for (const entry of detail.visited) map.set(getReferenceId(entry), entry);
    return [...map.values()];
  }, [references, detail.visited]);
  const navigation = detail.trail.length ? detail.trail : catalog.filtered;
  const activeIndex = navigation.findIndex(item => item.id === detail.activeId);
  const back = () => { setReturnedId(detail.activeId); detail.setDetail(false); setActionError(null); };
  const openInDock = () => {
    const entry = detail.active;
    if (!entry) return;
    if (entry.kind === 'url') dock.openLink(entry.url);
    else if (entry.kind === 'artifact') dock.openArtifact(entry.workspaceId, entry.artifactId);
    else dock.openNodeDetail(entry.workspaceId, entry.nodeId, detail.node?.title || entry.titleSnapshot || entry.nodeId);
  };
  const addToCanvas = async () => {
    const entry = detail.active;
    setActionError(null);
    if (!entry) return;
    if (entry.kind === 'node') { onAddReferenceToCanvas(entry); return; }
    if (entry.kind !== 'artifact' || entry.workspaceId !== activeWorkspaceId) return;
    setPinning(true);
    try {
      const result = await window.canvasWorkspace.artifacts.pinToCanvas(entry.workspaceId, entry.artifactId);
      if (!result.ok) setActionError(result.error || t('reference.libraryActionFailed'));
    } catch (reason) { setActionError(String(reason)); }
    finally { setPinning(false); }
  };
  const canPin = detail.active?.kind === 'node'
    || (detail.active?.kind === 'artifact' && detail.active.workspaceId === activeWorkspaceId);
  if (!state.shouldRender) return null;
  return (
    <aside className={`reference-drawer${state.isActive ? ' reference-drawer--open' : ''}${state.isResizing ? ' reference-drawer--resizing' : ''}`}
      style={state.drawerStyle} aria-hidden={!state.isActive}>
      <div className="reference-drawer-resize-handle" onMouseDown={state.handleResizeStart}
        role="separator" aria-orientation="vertical" aria-label={t('reference.resize')} title={t('reference.resize')} />
      <header className="reference-drawer-header"><h2>{t('reference.title')}</h2><div className="library-header-actions">
        {!detail.detail && <ReferenceUrlEditor
          handleAddUrl={() => { catalog.setSource('current'); catalog.setKind('all'); catalog.setQuery(''); state.handleAddUrl(); }}
          setUrlDraft={state.setUrlDraft} setUrlEditorOpen={state.setUrlEditorOpen} setUrlError={state.setUrlError}
          urlDraft={state.urlDraft} urlEditorOpen={state.urlEditorOpen} urlEditorRef={state.urlEditorRef} urlError={state.urlError} />}
        <Button variant="icon" size="sm" onClick={() => onOpenChange(false)} aria-label={t('reference.close')} title={t('reference.close')}>×</Button>
      </div></header>

      <div className="library-detail-nav" hidden={!detail.detail}>
        <Button ref={backButton} size="sm" onClick={back}>← {t('reference.libraryBack')}</Button>
        <div className="library-pagination"><span>{activeIndex >= 0 ? `${activeIndex + 1} / ${navigation.length}` : ''}</span>
          <Button variant="icon" size="sm" aria-label={t('reference.libraryPrevious')} disabled={activeIndex <= 0}
            onClick={() => { detail.open(navigation[activeIndex - 1]); setActionError(null); }}>←</Button>
          <Button variant="icon" size="sm" aria-label={t('reference.libraryNext')} disabled={activeIndex < 0 || activeIndex >= navigation.length - 1}
            onClick={() => { detail.open(navigation[activeIndex + 1]); setActionError(null); }}>→</Button>
        </div>
      </div>
      {detail.visited.length > 0 && <div className="library-preview-host" aria-hidden={!detail.detail}
        ref={el => { if (el) el.inert = !detail.detail || !state.isActive; }}>
        <Suspense fallback={<EmptyState title={t('reference.libraryLoading')} />}>
          <ReferencePreviewPanel activeWorkspaceId={activeWorkspaceId} references={previewEntries}
            activeReference={detail.active} activeReferenceNode={detail.node}
            copyUrl={state.copyUrl} drawerWidth={state.drawerWidth} getNodeByEntry={detail.getNode}
            onAddReferenceToCanvas={onAddReferenceToCanvas} onClearAll={onClearAll}
            onFocusNode={onFocusNode} onOpenUrl={state.openUrl} onRemoveReference={onRemoveReference}
            onUrlReferenceTitle={onUrlReferenceTitle} workspaceNameById={state.workspaceNameById} />
        </Suspense>
        {(detail.loading || detail.error) && <div className="library-detail-message" role="status">
          <EmptyState title={detail.loading ? t('reference.libraryLoading') : detail.error}
            action={!detail.loading && <Button size="sm" onClick={detail.retry}>{t('workspaceNodes.retry')}</Button>} />
        </div>}
      </div>}
      {detail.detail && <div key={detail.activeId} className="library-detail-transition" aria-hidden="true" />}
      <footer className="library-detail-footer" hidden={!detail.detail}>
        {actionError && <span className="library-action-error" role="alert">{actionError}</span>}
        <Button size="sm" onClick={openInDock} disabled={!detail.active || detail.loading || !!detail.error}>{t('reference.artifactOpenDock')}</Button>
        {detail.active?.kind !== 'url' && <Button size="sm" disabled={!canPin || pinning || detail.loading || !!detail.error}
          title={!canPin ? t('reference.artifactScopeBlocked') : t('reference.addToCanvas')} onClick={() => { void addToCanvas(); }}>{t('reference.addToCanvas')}</Button>}
        {detail.active?.kind === 'url' && <Button size="sm" onClick={() => { if (detail.active) onRemoveReference(getReferenceId(detail.active)); back(); }}>{t('reference.remove')}</Button>}
      </footer>

      <div className="library-browser" hidden={detail.detail}>
        <ReferenceDrawerToolbar source={catalog.source} onSourceChange={catalog.setSource}
          query={catalog.query} onQueryChange={catalog.setQuery} kind={catalog.kind} onKindChange={catalog.setKind}
          workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} />
        <div className="library-browse-meta" role="status">{catalog.loading ? t('reference.libraryLoading') : t('reference.libraryCount', { count: catalog.filtered.length })}</div>
        {catalog.error && <div className="library-browse-error" role="alert">{catalog.error}</div>}
        <ReferenceEntryList items={catalog.filtered} visible={!detail.detail && state.isActive} browseKey={catalog.browseKey}
          positions={positions.current} returnedId={returnedId} loading={catalog.loading}
          hasFilters={!!catalog.query.trim() || catalog.kind !== 'all'}
          onResetFilters={() => { catalog.setQuery(''); catalog.setKind('all'); }}
          workspaceNameById={state.workspaceNameById} onOpen={item => {
            detail.open(item, catalog.filtered); setReturnedId(item.id); setActionError(null);
            requestAnimationFrame(() => backButton.current?.focus());
          }} />
      </div>
    </aside>
  );
};

export type {
  NodeReferenceEntry as NodeReferenceEntryForCanvas,
  ReferenceEntry,
} from '../../../../shared/reference/types';
export { createReferenceNodeDataSnapshot } from '../../../../shared/reference/utils';
