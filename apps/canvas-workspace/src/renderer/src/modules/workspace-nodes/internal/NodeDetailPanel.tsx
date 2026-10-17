import type { ReactNode } from 'react';
import type { KnowledgeTagDefinition, WorkspaceNodeListItem, WorkspaceNodeRecord } from '../../../types';
import { useI18n } from '../../../i18n';
import { SparklesIcon } from '../../../components/icons';
import { NodeCanvasPreview } from './NodeCanvasPreview';
import { NodeDetailContextRail } from './NodeDetailContextRail';
import { NodeDetailHeader } from './NodeDetailHeader';
import { Button } from '../../../components/ui';
import { getNodeAiSummary, getNodeTags } from './utils';
import { getNodeDetailDescriptor } from './nodeDetailDescriptor';
// index.css owns the tag/chip classes and `--nodes-*` tokens this panel's
// subtree (NodeTagEditor) relies on. The Nodes pages get
// it via their own imports, but the right-dock Node tab renders this panel
// without any Nodes page on the lazy-loaded path, so the panel must pull it
// in itself.
import './index.css';
import './NodeDetailDocument.css';

interface Props {
  node: WorkspaceNodeRecord | null;
  workspaceId: string;
  loading?: boolean;
  error?: string | null;
  /** The record was read successfully and simply is not there any more. */
  missing?: boolean;
  mode?: 'page' | 'dock';
  headerAction?: ReactNode;
  compactDocument?: boolean;
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

export const NodeDetailPanel = ({
  node,
  workspaceId,
  loading,
  error,
  missing = false,
  mode = 'dock',
  headerAction,
  compactDocument = false,
  tagDefinitions = [],
  relationCandidates = [],
  readOnly = false,
  onNodePatched,
  onTagsChanged,
  onOpenPage,
  onBack,
  onRetry,
  onClose,
}: Props) => {
  const { t } = useI18n();
  const tags = getNodeTags(node);
  const aiSummary = getNodeAiSummary(node);
  const detail = getNodeDetailDescriptor(node?.type);
  // Dock tabs are reading surfaces: the body leads, and actions and tags
  // live behind the header's More menu.
  const isCompactDock = compactDocument && mode === 'dock';
  const isDocumentDock = isCompactDock && node?.type === 'file';
  const isRichDetail = detail.layout === 'workspace';

  // Tags are the only metadata a person manages here; the page keeps a rail
  // just for the confirmed AI summary, when there is one.
  const aiInsight = aiSummary ? (
    <section className="node-detail-panel__ai-insight">
      <div className="node-detail-panel__ai-insight-label">
        <SparklesIcon size={13} />
        <span>{t('workspaceNodes.aiSummary')} · {t('workspaceNodes.aiSummaryConfirmed')}</span>
      </div>
      <p>{aiSummary}</p>
    </section>
  ) : null;
  const hasContextRail = mode === 'page' && !isRichDetail && aiInsight !== null;

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
    <section className={`node-detail-panel node-detail-panel--${mode}${isCompactDock ? ' node-detail-panel--compact-dock' : ''}${isDocumentDock ? ' node-detail-panel--document-dock' : ''}${isRichDetail ? ` node-detail-panel--rich node-detail-panel--${detail.surface}` : ''}`}>
      <div className="node-detail-panel__content">
        {!node || loading || error || missing ? renderPlaceholder() : (
          <div className={`node-detail-panel__layout${hasContextRail ? '' : ' node-detail-panel__layout--single'}`}>
            <article className="node-detail-panel__document">
              <NodeDetailHeader
                compact={isCompactDock}
                hideTitle={isDocumentDock}
                onBack={mode === 'page' ? onBack : undefined}
                action={headerAction}
                inspectorContent={isCompactDock ? aiInsight : undefined}
                mode={mode}
                node={node}
                onNodePatched={onNodePatched}
                onOpenPage={onOpenPage}
                onTagsChanged={onTagsChanged}
                readOnly={readOnly}
                tagDefinitions={tagDefinitions}
                tags={tags}
                workspaceId={workspaceId}
              />

              {/* The dock is where most people land (list cards, graph nodes and
                * note mentions all open a tab), so the reading aid cannot be
                * page-only — the page just has a rail to spare for it. */}
              {mode === 'dock' && !isRichDetail && !isCompactDock && aiInsight}

              <div className="node-detail-panel__preview">
                <NodeCanvasPreview
                  workspaceId={workspaceId}
                  record={node}
                  mentionCandidates={relationCandidates}
                  minHeight={isRichDetail || isCompactDock ? 0 : mode === 'page' ? 480 : 320}
                  readOnly={readOnly}
                  onPatched={onNodePatched}
                />
              </div>
            </article>

            {hasContextRail && <NodeDetailContextRail aiInsight={aiInsight} />}
          </div>
        )}
      </div>
    </section>
  );
};
