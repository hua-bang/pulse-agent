import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KnowledgeTagDefinition, WorkspaceNodeListItem, WorkspaceNodeRecord } from '../../types';
import { useI18n } from '../../i18n';
import { dispatchFocusNodeOnCanvas, nodeLinkHref } from '../../utils/openNodeBridge';
import { CopyIcon, ListLinesIcon, NodeTypeIcon } from '../../components/icons';
import { Button } from '../../components/ui';
import { NodeDetailInspector } from './NodeDetailInspector';
import { NodeTagEditor } from './NodeTagEditor';
import { NodeTitleEditor } from './NodeTitleEditor';
import { getNodeTypeLabel, isKnowledgeNodeType } from './utils';

interface Props {
  candidates: WorkspaceNodeListItem[];
  dateLocale: string;
  metadata: 'inline' | 'inspector';
  mode: 'page' | 'dock';
  node: WorkspaceNodeRecord;
  onNodePatched?: (next: WorkspaceNodeRecord) => void;
  onOpenPage?: () => void;
  onTagsChanged?: () => void;
  readOnly: boolean;
  source: string;
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

const InfoGlyph = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <circle cx="7" cy="7" r="5.4" stroke="currentColor" strokeWidth="1.2" />
    <path d="M7 6.2v3.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <circle cx="7" cy="4.25" r="0.75" fill="currentColor" />
  </svg>
);

export const NodeDetailHeader = ({
  candidates,
  dateLocale,
  metadata,
  mode,
  node,
  onNodePatched,
  onOpenPage,
  onTagsChanged,
  readOnly,
  source,
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
          <div className="node-detail-panel__title-field">
            <NodeTitleEditor
              node={node}
              workspaceId={workspaceId}
              fallbackTitle={t('workspaceNodes.untitled')}
              readOnly={readOnly}
              onNodePatched={onNodePatched}
            />
          </div>
          <div className="node-detail-panel__title-actions">
            {mode === 'dock' && onOpenPage && (
              <Button variant="icon" size="xs" aria-label={t('workspaceNodes.goToDetail')} title={t('workspaceNodes.goToDetail')} onClick={onOpenPage}>
                <ListLinesIcon size={13} />
              </Button>
            )}
            {metadata === 'inspector' && (
              <Button
                ref={inspectorButtonRef}
                variant="icon"
                size="xs"
                aria-label={t('workspaceNodes.info')}
                aria-expanded={inspectorOpen}
                aria-controls={inspectorId}
                title={t('workspaceNodes.info')}
                onClick={() => setInspectorOpen((current) => !current)}
              >
                <InfoGlyph />
              </Button>
            )}
            <div className="node-detail-panel__actions" role="toolbar" aria-label={t('workspaceNodes.detailActions')}>
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
            </div>
          </div>
        </div>
        <div className="node-detail-panel__document-meta">
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
        </div>
      </header>
      {inspectorOpen && metadata === 'inspector' && (
        <NodeDetailInspector
          anchorRef={inspectorButtonRef}
          candidates={candidates}
          dateLocale={dateLocale}
          node={node}
          onClose={() => setInspectorOpen(false)}
          onNodePatched={onNodePatched}
          panelId={inspectorId}
          readOnly={readOnly}
          source={source}
          workspaceId={workspaceId}
        />
      )}
    </>
  );
};
