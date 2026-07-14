import type { KnowledgeTagDefinition, WorkspaceNodeListItem, WorkspaceNodeRecord } from '../../types';
import { useI18n } from '../../i18n';
import { ChevronRightIcon, NodeTypeIcon, SparklesIcon } from '../icons';
import { NodeCanvasPreview } from './NodeCanvasPreview';
import { NodeRelationEditor } from './NodeRelationEditor';
import { NodeTagEditor } from './NodeTagEditor';
import { NodeTitleEditor } from './NodeTitleEditor';
import { Button } from '../ui';
import { formatTime, getNodeAiSummary, getNodeTags, getNodeTypeLabel, isKnowledgeNodeType } from './utils';
import './NodeDetailDocument.css';

interface NodeDetailPanelProps {
  node: WorkspaceNodeRecord | null;
  workspaceId: string;
  loading?: boolean;
  error?: string | null;
  mode?: 'page' | 'dock';
  tagDefinitions?: KnowledgeTagDefinition[];
  relationCandidates?: WorkspaceNodeListItem[];
  readOnly?: boolean;
  onNodePatched?: (next: WorkspaceNodeRecord) => void;
  onTagsChanged?: () => void;
  onOpenPage?: () => void;
  onBack?: () => void;
}

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
  mode = 'dock',
  tagDefinitions = [],
  relationCandidates = [],
  readOnly = false,
  onNodePatched,
  onTagsChanged,
  onOpenPage,
  onBack,
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

  return (
    <section className={`node-detail-panel node-detail-panel--${mode}`}>
      <div className="node-detail-panel__content">
        {loading ? (
          <div className="node-detail-panel__empty">{t('workspaceNodes.loadingNode')}</div>
        ) : error ? (
          <div className="node-detail-panel__empty node-detail-panel__empty--error">{error}</div>
        ) : !node ? (
          <div className="node-detail-panel__empty">{t('workspaceNodes.selectNode')}</div>
        ) : (
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
              </header>

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
                    key={`${node.id}:backlinks`}
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
                {aiSummary && (
                  <section className="node-detail-panel__ai-insight">
                    <div className="node-detail-panel__ai-insight-label">
                      <SparklesIcon size={13} />
                      <span>{t('workspaceNodes.aiSummary')} · {t('workspaceNodes.aiSummaryConfirmed')}</span>
                    </div>
                    <p>{aiSummary}</p>
                  </section>
                )}
              </aside>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
