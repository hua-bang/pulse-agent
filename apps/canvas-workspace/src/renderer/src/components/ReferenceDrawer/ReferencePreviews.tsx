import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { CanvasNode } from '../../types';
import { CanvasNodeView } from '../CanvasNodeView';
import { useI18n } from '../../i18n';
import { MIN_REFERENCE_DRAWER_WIDTH } from './constants';
import type { NodeReferenceEntry, ReferenceEntry, UrlReferenceEntry } from './types';
import { createUrlPreviewNode, getReferenceId, isUrlReference } from './utils';

const IframeNodeBody = lazy(() => import('../IframeNodeBody').then((module) => ({
  default: module.IframeNodeBody,
})));

interface ReferencePreviewPanelProps {
  references: ReferenceEntry[];
  activeReference?: ReferenceEntry;
  activeReferenceNode?: CanvasNode;
  copyUrl: (url: string) => void;
  drawerWidth: number;
  getNodeByEntry: (entry: NodeReferenceEntry) => CanvasNode | undefined;
  onAddReferenceToCanvas: (entry: NodeReferenceEntry) => void;
  onClearAll: () => void;
  onFocusNode: (workspaceId: string, nodeId: string) => void;
  onOpenUrl: (url: string) => void;
  onRemoveReference: (referenceId: string) => void;
  workspaceNameById: Map<string, string>;
}

// Electron's <webview> tag is sensitive to layout / visibility changes on any
// ancestor — display:none, visibility:hidden, AND opacity:0 can all cause the
// compositor to drop the guest's layer and reload it next time it's shown.
// We keep stable layout boxes and layer the active preview on top. Inactive
// slots use pointer-events:none, which the shared WebView residency manager
// treats as non-visible and may discard under memory pressure.
const INACTIVE_SLOT_STYLE: CSSProperties = {
  zIndex: 1,
  pointerEvents: 'none',
};

const ACTIVE_SLOT_STYLE: CSSProperties = {
  zIndex: 2,
};

// Card-level covering: when the active reference is NOT a URL, the native card
// or hint overlay simply paints on top with its own opaque background; the URL
// card stays at z-index 1 with all its webviews fully alive underneath.

export const ReferencePreviewPanel = ({
  references,
  activeReference,
  activeReferenceNode,
  copyUrl,
  drawerWidth,
  getNodeByEntry,
  onAddReferenceToCanvas,
  onClearAll,
  onFocusNode,
  onOpenUrl,
  onRemoveReference,
  workspaceNameById,
}: ReferencePreviewPanelProps) => {
  const { t } = useI18n();
  const urlReferences = useMemo(
    () => references.filter(isUrlReference),
    [references],
  );
  const nodeReferences = useMemo(
    () => references.filter((entry): entry is NodeReferenceEntry => !isUrlReference(entry)),
    [references],
  );

  // Track URL references that have ever been opened. Their preview shells stay
  // mounted until removal; the guest itself may sleep under memory pressure.
  const [mountedUrlIds, setMountedUrlIds] = useState<Set<string>>(() => new Set());
  // Node references can also point at iframe nodes. Keep those iframe previews
  // mounted independently so switching the active reference doesn't navigate a
  // single reused <webview> back and forth.
  const [mountedNodeReferenceIds, setMountedNodeReferenceIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (activeReference && isUrlReference(activeReference)) {
      const id = activeReference.id;
      setMountedUrlIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    }
  }, [activeReference]);

  useEffect(() => {
    if (!activeReference || isUrlReference(activeReference)) return;
    if (activeReferenceNode?.type !== 'iframe') return;

    const id = getReferenceId(activeReference);
    setMountedNodeReferenceIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, [activeReference, activeReferenceNode]);

  useEffect(() => {
    setMountedUrlIds((prev) => {
      if (prev.size === 0) return prev;
      const liveIds = new Set(urlReferences.map((ref) => ref.id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (liveIds.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [urlReferences]);

  useEffect(() => {
    setMountedNodeReferenceIds((prev) => {
      if (prev.size === 0) return prev;
      const liveIds = new Set(nodeReferences.map(getReferenceId));
      const next = new Set<string>();
      let changed = false;

      for (const entry of nodeReferences) {
        const id = getReferenceId(entry);
        if (!prev.has(id)) continue;
        const node = getNodeByEntry(entry);
        if (!node || node.type === 'iframe') next.add(id);
        else changed = true;
      }

      prev.forEach((id) => {
        if (!liveIds.has(id)) changed = true;
      });
      if (next.size !== prev.size) changed = true;
      return changed ? next : prev;
    });
  }, [getNodeByEntry, nodeReferences]);

  const activeIsUrl = !!(activeReference && isUrlReference(activeReference));
  const activeUrlReference = activeIsUrl ? (activeReference as UrlReferenceEntry) : undefined;
  const activeReferenceId = activeReference ? getReferenceId(activeReference) : undefined;
  const activeNodeReferenceIsPersistent = !!(
    activeReference
    && !isUrlReference(activeReference)
    && activeReferenceNode?.type === 'iframe'
  );
  const activePersistentNodeReferenceId = activeNodeReferenceIsPersistent
    ? activeReferenceId
    : undefined;

  const persistentUrlPreviews = urlReferences.filter((ref) => mountedUrlIds.has(ref.id));
  const persistentNodePreviews = nodeReferences
    .filter((entry) => {
      const id = getReferenceId(entry);
      return mountedNodeReferenceIds.has(id) || id === activePersistentNodeReferenceId;
    })
    .map((entry) => ({ entry, node: getNodeByEntry(entry) }))
    .filter((item): item is { entry: NodeReferenceEntry; node: CanvasNode } => item.node?.type === 'iframe');

  return (
    <div className="reference-preview-area">
      {persistentUrlPreviews.length > 0 && (
        <div
          className="reference-url-card reference-url-card--preview reference-url-card--persistent"
          style={activeIsUrl ? ACTIVE_SLOT_STYLE : INACTIVE_SLOT_STYLE}
        >
          <div className="reference-url-stack">
            {persistentUrlPreviews.map((ref) => (
              <div
                key={ref.id}
                className="reference-url-slot"
                style={ref.id === activeReferenceId ? ACTIVE_SLOT_STYLE : INACTIVE_SLOT_STYLE}
              >
                <ReferenceUrlWebPreview
                  reference={ref}
                  drawerWidth={drawerWidth}
                  isActive={ref.id === activeReferenceId}
                />
              </div>
            ))}
          </div>
          {activeUrlReference && (
            <div className="reference-card-footer">
              <button
                className="reference-drawer-secondary"
                type="button"
                onClick={() => onOpenUrl(activeUrlReference.url)}
              >
                {t('reference.open')}
              </button>
              <button
                className="reference-drawer-secondary"
                type="button"
                onClick={() => copyUrl(activeUrlReference.url)}
              >
                {t('reference.copyUrl')}
              </button>
              <button
                className="reference-drawer-secondary"
                type="button"
                onClick={() => onRemoveReference(activeUrlReference.id)}
              >
                {t('reference.unpin')}
              </button>
              <button
                className="reference-drawer-secondary"
                type="button"
                onClick={onClearAll}
                title={t('reference.clearAllTitle')}
              >
                {t('reference.clearAll')}
              </button>
            </div>
          )}
        </div>
      )}

      {persistentNodePreviews.map(({ entry, node }) => {
        const id = getReferenceId(entry);
        const isActive = id === activeReferenceId;
        return (
          <div
            key={id}
            className="reference-native-card reference-native-card--persistent"
            style={isActive ? ACTIVE_SLOT_STYLE : INACTIVE_SLOT_STYLE}
          >
            <ReferenceNativeNodePreview
              node={node}
              drawerWidth={drawerWidth}
              isActive={isActive}
              workspaceName={workspaceNameById.get(entry.workspaceId) ?? entry.workspaceNameSnapshot}
              onFocusNode={() => onFocusNode(entry.workspaceId, entry.nodeId)}
            />
            {isActive && (
              <NodeReferenceFooter
                entry={entry}
                onAddReferenceToCanvas={onAddReferenceToCanvas}
                onClearAll={onClearAll}
                onFocusNode={onFocusNode}
                onRemoveReference={onRemoveReference}
              />
            )}
          </div>
        );
      })}

      {activeReference && !isUrlReference(activeReference) && activeReferenceNode && !activeNodeReferenceIsPersistent && (
        <div className="reference-native-card reference-native-card--persistent">
          <ReferenceNativeNodePreview
            node={activeReferenceNode}
            drawerWidth={drawerWidth}
            isActive
            workspaceName={workspaceNameById.get(activeReference.workspaceId) ?? activeReference.workspaceNameSnapshot}
            onFocusNode={() => onFocusNode(activeReference.workspaceId, activeReference.nodeId)}
          />
          <NodeReferenceFooter
            entry={activeReference}
            onAddReferenceToCanvas={onAddReferenceToCanvas}
            onClearAll={onClearAll}
            onFocusNode={onFocusNode}
            onRemoveReference={onRemoveReference}
          />
        </div>
      )}

      {activeReference && !isUrlReference(activeReference) && !activeReferenceNode && (
        <div className="reference-pick-hint reference-pick-hint--overlay">{t('reference.sourceMissing')}</div>
      )}

      {!activeReference && (
        <div className="reference-pick-hint reference-pick-hint--overlay">{t('reference.pickPreviewHint')}</div>
      )}
    </div>
  );
};

interface NodeReferenceFooterProps {
  entry: NodeReferenceEntry;
  onAddReferenceToCanvas: (entry: NodeReferenceEntry) => void;
  onClearAll: () => void;
  onFocusNode: (workspaceId: string, nodeId: string) => void;
  onRemoveReference: (referenceId: string) => void;
}

const NodeReferenceFooter = ({
  entry,
  onAddReferenceToCanvas,
  onClearAll,
  onFocusNode,
  onRemoveReference,
}: NodeReferenceFooterProps) => {
  const { t } = useI18n();

  return (
    <div className="reference-card-footer">
      <button
        className="reference-drawer-secondary"
        type="button"
        onClick={() => onFocusNode(entry.workspaceId, entry.nodeId)}
        title={t('reference.openSource')}
      >
        {t('reference.openSource')}
      </button>
      <button
        className="reference-drawer-secondary"
        type="button"
        onClick={() => onAddReferenceToCanvas(entry)}
      >
        {t('reference.addToCanvas')}
      </button>
      <button
        className="reference-drawer-secondary"
        type="button"
        onClick={() => onRemoveReference(getReferenceId(entry))}
      >
        {t('reference.unpin')}
      </button>
      <button
        className="reference-drawer-secondary"
        type="button"
        onClick={onClearAll}
        title={t('reference.clearAllTitle')}
      >
        {t('reference.clearAll')}
      </button>
    </div>
  );
};

interface ReferenceUrlWebPreviewProps {
  reference: UrlReferenceEntry;
  drawerWidth: number;
  isActive: boolean;
}

const ReferenceUrlWebPreview = memo(({ reference, drawerWidth, isActive }: ReferenceUrlWebPreviewProps) => {
  const previewNode = useMemo(
    () => createUrlPreviewNode(reference, drawerWidth),
    [reference, drawerWidth],
  );

  return (
    <div className="reference-url-preview">
      <Suspense fallback={null}>
        <IframeNodeBody
          node={previewNode}
          onUpdate={() => undefined}
          isSelected={isActive}
          isResizing={false}
          readOnly
        />
      </Suspense>
    </div>
  );
});

ReferenceUrlWebPreview.displayName = 'ReferenceUrlWebPreview';

interface ReferenceNativeNodePreviewProps {
  node: CanvasNode;
  drawerWidth: number;
  isActive: boolean;
  workspaceName?: string;
  onFocusNode: () => void;
}

const ReferenceNativeNodePreview = memo(({
  node,
  drawerWidth,
  isActive,
  workspaceName,
  onFocusNode,
}: ReferenceNativeNodePreviewProps) => {
  const previewNode = useMemo(
    () => ({
      ...node,
      x: 0,
      y: 0,
      width: Math.max(MIN_REFERENCE_DRAWER_WIDTH - 32, drawerWidth - 32),
      height: 420,
    }),
    [drawerWidth, node],
  );

  const getPreviewNodes = useCallback(() => [node], [node]);
  const handleFocus = useCallback(() => onFocusNode(), [onFocusNode]);

  return (
    <CanvasNodeView
      node={previewNode}
      getAllNodes={getPreviewNodes}
      workspaceName={workspaceName}
      isDragging={false}
      isResizing={false}
      isSelected={isActive}
      isHighlighted={false}
      onDragStart={() => undefined}
      onResizeStart={() => undefined}
      onUpdate={() => undefined}
      onAutoResize={() => undefined}
      onRemove={() => undefined}
      onExportMindmapImage={() => undefined}
      onSelect={() => undefined}
      onFocus={handleFocus}
      readOnly
    />
  );
});

ReferenceNativeNodePreview.displayName = 'ReferenceNativeNodePreview';
