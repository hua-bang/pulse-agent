import { useCallback, useEffect, useState } from 'react';
import type { KnowledgeTagDefinition, WorkspaceNodeListItem, WorkspaceNodeRecord } from '../../types';
import { useI18n } from '../../i18n';
import { ChevronRightIcon, CopyIcon, NodeTypeIcon, SparklesIcon } from '../icons';
import { NodeCanvasPreview } from './NodeCanvasPreview';
import { NodeRelationEditor } from './NodeRelationEditor';
import { NodeTagEditor } from './NodeTagEditor';
import { NodeTitleEditor } from './NodeTitleEditor';
import { Button } from '../ui';
import { dispatchFocusNodeOnCanvas, nodeLinkHref } from '../../utils/openNodeBridge';
import { formatTime, getNodeAiSummary, getNodeTags, getNodeTypeLabel, isKnowledgeNodeType } from './utils';
// index.css owns the tag/chip classes and `--nodes-*` tokens this panel's
// subtree (NodeTagEditor, NodeRelationEditor) relies on. The Nodes pages get
// it via their own imports, but the right-dock Node tab renders this panel
// without any Nodes page on the lazy-loaded path, so the panel must pull it
// in itself.
import './index.css';
import './NodeDetailDocument.css';

interface NodeDetailPanelProps {
  node: WorkspaceNodeRecord | null;
  workspaceId: string;
  loading?: boolean;
  error?: string | null;
  /** The record was read successfully and simply is not there any more. */
  missing?: boolean;
  mode?: 'page' | 'dock';
  tagDefinitions?: KnowledgeTagDefinition[];
  relationCandidates?: WorkspaceNodeListItem[];
  readOnly?: boolean;
  onNodePatched?: (next: WorkspaceNodeRecord) => void;
  onTagsChanged?: () => void;
  onOpenPage?: () => void;
  onBack?: () => void;
  onRetry?: () => void;
  /** Dismiss the host surface once its node is gone (dock: close the tab). */
  onClose?: () => void;
}

/** Crosshair — "show me where this lives on the canvas". Inline by the icons
 *  module's own scope rule: single-use glyphs stay with their context. */
const TargetGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <circle cx="7" cy="7" r="2.1" stroke="currentColor" strokeWidth="1.3" />
    <path
      d="M7 1.6v2.1M7 10.3v2.1M1.6 7h2.1M10.3 7h2.1"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
  </svg>
);

const propertyEntries = (node: WorkspaceNodeRecord | null) => {
  if (!node?.properties) return [];
  return Object.entries(node.properties).filter(([key]) => key !== 'tags');
};

const renderPropertyValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(renderPropertyValue).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    const typed = value as { type?: unknown; value?: unknown; path?: unknown; nodeId?: unknown };
    if (typeof typed.value === 'string') return typed.value;
    if (typeof typed.path === 'string') return typed.path;
    if (typeof typed.nodeId === 'string') return typed.nodeId;
    return JSON.stringify(value);
  }
  return String(value);
};

export const NodeDetailPanel = ({
  node,
  workspaceId,
  loading,
  error,
  missing = false,
  mode = 'dock',
  tagDefinitions = [],
  relationCandidates = [],
  readOnly = false,
  onNodePatched,
  onTagsChanged,
  onOpenPage,
  onBack,
  onRetry,
  onClose,
}: NodeDetailPanelProps) => {
  const { language, t } = useI18n();
  const dateLocale = language === 'zh' ? 'zh-CN' : 'en-US';
  const tags = getNodeTags(node);
  const properties = propertyEntries(node);
  const links = node?.links ?? [];
  const source = node ? renderPropertyValue(node.properties?.source) : '';
  const aiSummary = getNodeAiSummary(node);
  const infoProperties = mode === 'page'
    ? properties.filter(([key]) => key !== 'source' && key !== 'aiSummary')
    : properties.filter(([key]) => key !== 'aiSummary');

  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => setCopyState('idle'), [node?.id]);
  useEffect(() => {
    if (copyState === 'idle') return undefined;
    const timer = window.setTimeout(() => setCopyState('idle'), 2000);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const copyNodeLink = useCallback(async () => {
    if (!node) return;
    try {
      await navigator.clipboard.writeText(nodeLinkHref(node.id, workspaceId));
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }, [node, workspaceId]);

  const aiInsight = aiSummary ? (
    <section className="node-detail-panel__ai-insight">
      <div className="node-detail-panel__ai-insight-label">
        <SparklesIcon size={13} />
        <span>{t('workspaceNodes.aiSummary')} · {t('workspaceNodes.aiSummaryConfirmed')}</span>
      </div>
      <p>{aiSummary}</p>
    </section>
  ) : null;

  const renderPlaceholder = () => {
    if (loading) {
      // A skeleton, not a line of text: switching nodes in the dock replaces
      // a full document, and collapsing that to one centred sentence reads as
      // the surface breaking rather than loading.
      return (
        <div className="node-detail-panel__skeleton" role="status" aria-label={t('workspaceNodes.loadingNode')}>
          <div className="node-detail-panel__skeleton-line node-detail-panel__skeleton-line--title" />
          <div className="node-detail-panel__skeleton-line node-detail-panel__skeleton-line--meta" />
          <div className="node-detail-panel__skeleton-block" />
        </div>
      );
    }
    if (error) {
      return (
        <div className="node-detail-panel__empty node-detail-panel__empty--error">
          <p>{error}</p>
          {onRetry && (
            <Button size="xs" onClick={onRetry}>{t('workspaceNodes.retry')}</Button>
          )}
        </div>
      );
    }
    if (missing) {
      return (
        <div className="node-detail-panel__empty">
          <p>{t('workspaceNodes.nodeMissing')}</p>
          <p className="node-detail-panel__empty-hint">{t('workspaceNodes.nodeMissingHint')}</p>
          {onClose && (
            <Button size="xs" onClick={onClose}>{t('workspaceNodes.closeTab')}</Button>
          )}
          {!onClose && onBack && (
            <Button size="xs" onClick={onBack}>{t('workspaceNodes.back')}</Button>
          )}
        </div>
      );
    }
    return <div className="node-detail-panel__empty">{t('workspaceNodes.selectNode')}</div>;
  };

  return (
    <section className={`node-detail-panel node-detail-panel--${mode}`}>
      <div className="node-detail-panel__content">
        {!node || loading || error || missing ? renderPlaceholder() : (
          <div className="node-detail-panel__layout">
            <article className="node-detail-panel__document">
              {mode === 'page' && onBack && (
                <Button size="xs" className="node-detail-panel__back" onClick={onBack}>
                  <span aria-hidden="true">←</span>
                  {t('workspaceNodes.back')}
                </Button>
              )}
              <header className="node-detail-panel__document-header">
                <div className="node-detail-panel__title-row">
                  <div className="node-detail-panel__title-field">
                    <NodeTitleEditor
                      node={node}
                      workspaceId={workspaceId}
                      fallbackTitle={t('workspaceNodes.untitled')}
                      readOnly={readOnly}
                      onNodePatched={onNodePatched}
                    />
                  </div>
                  {mode === 'dock' && onOpenPage && (
                    <Button size="xs" onClick={onOpenPage}>
                      {t('workspaceNodes.goToDetail')}
                    </Button>
                  )}
                </div>
                <div className="node-detail-panel__document-meta">
                  <span className="node-detail-panel__type">
                    {isKnowledgeNodeType(node.type) && <NodeTypeIcon type={node.type} size={14} />}
                    <span>{getNodeTypeLabel(node.type, t, t('workspaceNodes.genericNode'))}</span>
                  </span>
                  <span className="node-detail-panel__meta-divider" aria-hidden="true" />
                  <div className="node-detail-panel__document-tags">
                    <NodeTagEditor
                      node={node}
                      workspaceId={workspaceId}
                      tags={tags}
                      tagDefinitions={tagDefinitions}
                      readOnly={readOnly}
                      onNodePatched={onNodePatched}
                      onTagsChanged={onTagsChanged}
                    />
                  </div>
                </div>
                {/* The node lives on a canvas and is reachable as a `@` mention
                  * elsewhere; both are one click from here rather than a trip
                  * back through the Nodes list. */}
                <div
                  className="node-detail-panel__actions"
                  role="toolbar"
                  aria-label={t('workspaceNodes.detailActions')}
                >
                  <Button
                    size="xs"
                    onClick={() => dispatchFocusNodeOnCanvas({ workspaceId, nodeId: node.id })}
                  >
                    <TargetGlyph />
                    {t('workspaceNodes.openOnCanvas')}
                  </Button>
                  <Button size="xs" onClick={() => { void copyNodeLink(); }}>
                    <CopyIcon size={12} />
                    {copyState === 'copied'
                      ? t('workspaceNodes.copied')
                      : copyState === 'failed'
                        ? t('workspaceNodes.copyLinkFailed')
                        : t('workspaceNodes.copyLink')}
                  </Button>
                </div>
              </header>

              {/* The dock is where most people land (list cards, graph nodes and
                * note mentions all open a tab), so the reading aid cannot be
                * page-only — the page just has a rail to spare for it. */}
              {mode === 'dock' && aiInsight}

              <div className="node-detail-panel__preview">
                <NodeCanvasPreview
                  workspaceId={workspaceId}
                  record={node}
                  mentionCandidates={relationCandidates}
                  minHeight={mode === 'page' ? 480 : 320}
                  readOnly={readOnly}
                  onPatched={onNodePatched}
                />
              </div>

              <div className="node-detail-panel__supplementary">
                {mode === 'dock' && (
                  <details
                    key={`${node.id}:relations`}
                    className="node-detail-panel__disclosure"
                  >
                    <summary>
                      <ChevronRightIcon className="node-detail-panel__disclosure-chevron" />
                      <span>{t('workspaceNodes.relations.title')}</span>
                      <span className="node-detail-panel__disclosure-count">{links.length}</span>
                    </summary>
                    <div className="node-detail-panel__disclosure-body node-detail-panel__links">
                      <NodeRelationEditor
                        node={node}
                        workspaceId={workspaceId}
                        candidates={relationCandidates}
                        readOnly={readOnly}
                        onNodePatched={onNodePatched}
                      />
                    </div>
                  </details>
                )}

              <details
                key={`${node.id}:info`}
                className="node-detail-panel__disclosure"
              >
                <summary>
                  <ChevronRightIcon className="node-detail-panel__disclosure-chevron" />
                  <span>{t('workspaceNodes.info')}</span>
                </summary>
                <div className="node-detail-panel__disclosure-body">
                  <div className="node-detail-panel__property-row">
                    <span>{t('workspaceNodes.updated')}</span>
                    <strong>{formatTime(node.updatedAt, t('workspaceNodes.noTimestamp'), dateLocale)}</strong>
                  </div>
                  {node.createdAt !== undefined && (
                    <div className="node-detail-panel__property-row">
                      <span>{t('workspaceNodes.created')}</span>
                      <strong>{formatTime(node.createdAt, t('workspaceNodes.noTimestamp'), dateLocale)}</strong>
                    </div>
                  )}
                  {infoProperties.map(([key, value]) => (
                    <div key={key} className="node-detail-panel__property-row">
                      <span>{key}</span>
                      <strong>{renderPropertyValue(value)}</strong>
                    </div>
                  ))}
                </div>
                </details>
              </div>
            </article>

            {mode === 'page' && (
              <aside className="node-detail-panel__context-rail" aria-label={t('workspaceNodes.info')}>
                <section className="node-detail-panel__rail-section">
                  <h2>{t('workspaceNodes.source')}</h2>
                  {source
                    ? <p className="node-detail-panel__source" title={source}>{source}</p>
                    : <p className="node-detail-panel__rail-empty">{t('workspaceNodes.noSource')}</p>}
                </section>
                <section className="node-detail-panel__rail-section">
                  <div className="node-detail-panel__rail-heading">
                    <h2>{t('workspaceNodes.relations.title')}</h2>
                    <span>{links.length}</span>
                  </div>
                  <NodeRelationEditor
                    node={node}
                    workspaceId={workspaceId}
                    candidates={relationCandidates}
                    readOnly={readOnly}
                    onNodePatched={onNodePatched}
                  />
                </section>
                {aiInsight}
              </aside>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
