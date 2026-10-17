import './index.css';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { KnowledgeTagDefinition, WorkspaceNodeRecord } from '../../../../types';
import { useI18n } from '../../../../i18n';
import { dispatchFocusNodeOnCanvas, nodeLinkHref } from '../../../../utils/openNodeBridge';
import { ChevronRightIcon, CopyIcon, ListLinesIcon, NodeTypeIcon } from '../../../../components/icons';
import { Button } from '../../../../components/ui';
import { NodeDetailInspector } from '../NodeDetailInspector';
import { NodeTagEditor } from '../NodeTagEditor';
import { NodeTitleEditor } from '../NodeTitleEditor';
import { getNodeTypeLabel, isKnowledgeNodeType } from '../utils';

interface Props {
  compact?: boolean;
  /** Hide the title field (a document's body already opens with its heading). */
  hideTitle?: boolean;
  action?: ReactNode;
  inspectorContent?: ReactNode;
  mode: 'page' | 'dock';
  node: WorkspaceNodeRecord;
  /** Page only: return to the view the page was opened from. */
  onBack?: () => void;
  onNodePatched?: (next: WorkspaceNodeRecord) => void;
  onOpenPage?: () => void;
  onTagsChanged?: () => void;
  readOnly: boolean;
  tagDefinitions: KnowledgeTagDefinition[];
  tags: string[];
  workspaceId: string;
}

const TargetGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <circle cx="7" cy="7" r="2.1" stroke="currentColor" strokeWidth="1.3" />
    <path d="M7 1.6v2.1M7 10.3v2.1M1.6 7h2.1M10.3 7h2.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

const MoreGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="3.5" cy="8" r="1.2" fill="currentColor" />
    <circle cx="8" cy="8" r="1.2" fill="currentColor" />
    <circle cx="12.5" cy="8" r="1.2" fill="currentColor" />
  </svg>
);

export const NodeDetailHeader = ({
  compact,
  hideTitle = false,
  action,
  inspectorContent,
  mode,
  node,
  onBack,
  onNodePatched,
  onOpenPage,
  onTagsChanged,
  readOnly,
  tagDefinitions,
  tags,
  workspaceId,
}: Props) => {
  const { t } = useI18n();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const inspectorButtonRef = useRef<HTMLButtonElement>(null);
  const inspectorId = useId();

  useEffect(() => {
    setCopyState('idle');
    setInspectorOpen(false);
  }, [node.id]);
  useEffect(() => {
    if (copyState === 'idle') return undefined;
    const timer = window.setTimeout(() => setCopyState('idle'), 2000);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const copyNodeLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(nodeLinkHref(node.id, workspaceId));
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }, [node.id, workspaceId]);
  const copyLabel = copyState === 'copied'
    ? t('workspaceNodes.copied')
    : copyState === 'failed'
      ? t('workspaceNodes.copyLinkFailed')
      : t('workspaceNodes.copyLink');

  return (
    <>
      <header className="node-detail-panel__document-header">
        <div className="node-detail-panel__title-row">
          {onBack && (
            <Button
              variant="icon"
              size="xs"
              className="node-detail-panel__back"
              aria-label={t('workspaceNodes.back')}
              title={t('workspaceNodes.back')}
              onClick={onBack}
            >
              <ChevronRightIcon className="node-detail-panel__back-chevron" />
            </Button>
          )}
          {!hideTitle && <div className="node-detail-panel__title-field">
            <NodeTitleEditor
              node={node}
              workspaceId={workspaceId}
              fallbackTitle={t('workspaceNodes.untitled')}
              readOnly={readOnly}
              onNodePatched={onNodePatched}
            />
          </div>}
          <div className="node-detail-panel__title-actions">
            {action}
            {mode === 'dock' && !compact && onOpenPage && (
              <Button variant="icon" size="xs" aria-label={t('workspaceNodes.goToDetail')} title={t('workspaceNodes.goToDetail')} onClick={onOpenPage}>
                <ListLinesIcon size={13} />
              </Button>
            )}
            {compact && (
              <Button
                ref={inspectorButtonRef}
                variant="icon"
                size="xs"
                aria-label={t('workspaceNodes.moreActions')}
                aria-expanded={inspectorOpen}
                aria-controls={inspectorId}
                title={t('workspaceNodes.moreActions')}
                onClick={() => setInspectorOpen((current) => !current)}
              >
                <MoreGlyph />
              </Button>
            )}
            {!compact && <div className="node-detail-panel__actions" role="toolbar" aria-label={t('workspaceNodes.detailActions')}>
              <Button
                variant={mode === 'dock' ? 'icon' : 'secondary'}
                size="xs"
                aria-label={t('workspaceNodes.openOnCanvas')}
                title={t('workspaceNodes.openOnCanvas')}
                onClick={() => dispatchFocusNodeOnCanvas({ workspaceId, nodeId: node.id })}
              >
                <TargetGlyph />
                {mode === 'page' && <span>{t('workspaceNodes.openOnCanvas')}</span>}
              </Button>
              <Button variant={mode === 'dock' ? 'icon' : 'secondary'} size="xs" aria-label={copyLabel} title={t('workspaceNodes.copyLink')} onClick={() => { void copyNodeLink(); }}>
                <CopyIcon size={12} />
                {mode === 'page' && <span>{copyLabel}</span>}
              </Button>
            </div>}
          </div>
        </div>
        {!compact && <div className="node-detail-panel__document-meta">
          <span className="node-detail-panel__type">
            {isKnowledgeNodeType(node.type) && <NodeTypeIcon type={node.type} size={14} colorize />}
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
        </div>}
      </header>
      {inspectorOpen && compact && (
        <NodeDetailInspector
          anchorRef={inspectorButtonRef}
          onClose={() => setInspectorOpen(false)}
          panelId={inspectorId}
          title={t('workspaceNodes.moreActions')}
        >
          <div className="node-detail-panel__inspector-actions" role="toolbar" aria-label={t('workspaceNodes.detailActions')}>
            {onOpenPage && (
              <Button size="xs" onClick={onOpenPage}>
                <ListLinesIcon size={13} />
                <span>{t('workspaceNodes.goToDetail')}</span>
              </Button>
            )}
            <Button size="xs" onClick={() => dispatchFocusNodeOnCanvas({ workspaceId, nodeId: node.id })}>
              <TargetGlyph />
              <span>{t('workspaceNodes.openOnCanvas')}</span>
            </Button>
            <Button size="xs" aria-label={copyLabel} onClick={() => { void copyNodeLink(); }}>
              <CopyIcon size={12} />
              <span>{copyLabel}</span>
            </Button>
          </div>
          {inspectorContent}
          <div className="node-detail-panel__inspector-section">
            <NodeTagEditor node={node} workspaceId={workspaceId} tags={tags} tagDefinitions={tagDefinitions}
              readOnly={readOnly} onNodePatched={onNodePatched} onTagsChanged={onTagsChanged} />
          </div>
        </NodeDetailInspector>
      )}
    </>
  );
};

