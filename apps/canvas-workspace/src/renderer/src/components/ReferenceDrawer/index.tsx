import './index.css';
import type { CanvasNode } from '../../types';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import { ReferenceDrawerToolbar } from './ReferenceDrawerToolbar';
import { ReferenceEmptyState } from './ReferenceEmptyState';
import { ReferenceEntryList } from './ReferenceEntryList';
import { ReferencePreviewPanel } from './ReferencePreviews';
import type { NodeReferenceEntry, ReferenceEntry } from './types';
import { useReferenceDrawerState } from './useReferenceDrawerState';
import { getReferenceId } from './utils';
import { useI18n } from '../../i18n';

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
  onUrlReferenceTitle?: (referenceId: string, title: string) => void;
  onFocusNode: (workspaceId: string, nodeId: string) => void;
  onAddReferenceToCanvas: (entry: NodeReferenceEntry) => void;
  onWorkspaceNodesRequest: (workspaceId: string) => void;
}

export const ReferenceDrawer = ({
  open,
  activeWorkspaceId,
  workspaces,
  references,
  activeReference,
  activeReferenceNode,
  nodes,
  allNodes,
  selectedNode,
  onOpenChange,
  onSelectReference,
  onRemoveReference,
  onClearAll,
  onAddReference,
  onAddUrlReference,
  onUrlReferenceTitle,
  onFocusNode,
  onAddReferenceToCanvas,
  onWorkspaceNodesRequest,
}: ReferenceDrawerProps) => {
  const { t } = useI18n();
  const state = useReferenceDrawerState({
    open,
    activeWorkspaceId,
    workspaces,
    references,
    nodes,
    allNodes,
    onAddReference,
    onAddUrlReference,
    onWorkspaceNodesRequest,
  });

  if (!state.shouldRender) return null;

  const activeReferenceId = activeReference ? getReferenceId(activeReference) : undefined;
  const hasReferences = references.length > 0;

  return (
    <aside
      className={`reference-drawer${state.isActive ? ' reference-drawer--open' : ''}${state.isResizing ? ' reference-drawer--resizing' : ''}`}
      style={state.drawerStyle}
      aria-hidden={!state.isActive}
    >
      <div
        className="reference-drawer-resize-handle"
        onMouseDown={state.handleResizeStart}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('reference.resize')}
        title={t('reference.resize')}
      />
      <header className="reference-drawer-header">
        <div>
          <div className="reference-drawer-kicker">{t('reference.kicker')}</div>
          <h2>{t('reference.title')}</h2>
        </div>
        <button
          className="reference-drawer-icon-button"
          type="button"
          onClick={() => onOpenChange(false)}
          title={t('reference.close')}
          aria-label={t('reference.close')}
        >
          x
        </button>
      </header>

      <ReferenceDrawerToolbar
        activeWorkspaceId={activeWorkspaceId}
        allNodes={allNodes}
        currentNodeCount={state.eligibleCurrentNodeCount}
        externalWorkspaceId={state.externalWorkspaceId}
        externalWorkspaces={state.externalWorkspaces}
        handleAddFromPicker={state.handleAddFromPicker}
        handleAddUrl={state.handleAddUrl}
        pickerOpen={state.pickerOpen}
        pickerRef={state.pickerRef}
        pickableNodeGroups={state.pickableNodeGroups}
        pickableNodes={state.pickableNodes}
        searchActive={state.searchActive}
        searchDraft={state.searchDraft}
        setExternalWorkspaceId={state.setExternalWorkspaceId}
        setPickerOpen={state.setPickerOpen}
        setSearchDraft={state.setSearchDraft}
        setUrlDraft={state.setUrlDraft}
        setUrlEditorOpen={state.setUrlEditorOpen}
        setUrlError={state.setUrlError}
        urlDraft={state.urlDraft}
        urlEditorOpen={state.urlEditorOpen}
        urlEditorRef={state.urlEditorRef}
        urlError={state.urlError}
        workspaceNameById={state.workspaceNameById}
      />

      <div className="reference-drawer-content">
        {!hasReferences ? (
          <ReferenceEmptyState selectedNode={selectedNode} />
        ) : (
          <>
            <div className="reference-entry-list">
              <ReferenceEntryList
                entries={references}
                activeWorkspaceId={activeWorkspaceId}
                workspaceNameById={state.workspaceNameById}
                getNodeByEntry={state.getNodeByEntry}
                activeId={activeReferenceId}
                onSelect={onSelectReference}
                onFocus={onFocusNode}
                onOpenUrl={state.openUrl}
                onRemove={onRemoveReference}
              />
            </div>

            <ReferencePreviewPanel
              references={references}
              activeReference={activeReference}
              activeReferenceNode={activeReferenceNode}
              copyUrl={state.copyUrl}
              drawerWidth={state.drawerWidth}
              getNodeByEntry={state.getNodeByEntry}
              onAddReferenceToCanvas={onAddReferenceToCanvas}
              onClearAll={onClearAll}
              onFocusNode={onFocusNode}
              onOpenUrl={state.openUrl}
              onRemoveReference={onRemoveReference}
              onUrlReferenceTitle={onUrlReferenceTitle}
              workspaceNameById={state.workspaceNameById}
            />
          </>
        )}
      </div>
    </aside>
  );
};

export type {
  NodeReferenceEntry as NodeReferenceEntryForCanvas,
  ReferenceEntry,
} from './types';
export { createReferenceNodeDataSnapshot } from './utils';
