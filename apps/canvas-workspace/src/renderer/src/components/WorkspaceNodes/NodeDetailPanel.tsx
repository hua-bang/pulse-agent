import type { KnowledgeTagDefinition, WorkspaceNodeRecord } from '../../types';
import { useI18n } from '../../i18n';
import { ChevronRightIcon, CloseIcon } from '../icons';
import { Button } from '../ui';
import { NodeCanvasPreview } from './NodeCanvasPreview';
import { NodeTagEditor } from './NodeTagEditor';
import { NodeTitleEditor } from './NodeTitleEditor';
import { formatTime, getNodeTags, getNodeTitle, getNodeTypeLabel } from './utils';
import './NodeDetailDocument.css';

interface NodeDetailPanelProps {
  node: WorkspaceNodeRecord | null;
  workspaceId: string;
  loading?: boolean;
  error?: string | null;
  mode?: 'drawer' | 'page';
  onClose?: () => void;
  onOpenPage?: (nodeId: string) => void;
  tagDefinitions?: KnowledgeTagDefinition[];
  readOnly?: boolean;
  onNodePatched?: (next: WorkspaceNodeRecord) => void;
  onTagsChanged?: () => void;
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
  mode = 'drawer',
  onClose,
  onOpenPage,
  tagDefinitions = [],
  readOnly = false,
  onNodePatched,
  onTagsChanged,
}: NodeDetailPanelProps) => {
  const { language, t } = useI18n();
  const dateLocale = language === 'zh' ? 'zh-CN' : 'en-US';
  const title = getNodeTitle(node, t('workspaceNodes.untitled'));
  const tags = getNodeTags(node);
  const properties = propertyEntries(node);
  const links = node?.links ?? [];

  return (
    <section className={`node-detail-panel node-detail-panel--${mode}`}>
      {mode === 'drawer' && (
        <header className="node-detail-panel__header">
          <span className="node-detail-panel__context" title={title}>
            {t('workspaceNodes.nodeDetail')}
          </span>
          <div className="node-detail-panel__header-actions">
            {node && onOpenPage && (
              <Button size="sm" onClick={() => onOpenPage(node.id)}>
                {t('workspaceNodes.full')}
              </Button>
            )}
            {onClose && (
              <Button
                className="node-detail-panel__close"
                variant="icon"
                size="md"
                onClick={onClose}
                aria-label={t('workspaceNodes.closeNodeDetail')}
              >
                <CloseIcon size={16} />
              </Button>
            )}
          </div>
        </header>
      )}

      <div className="node-detail-panel__content">
        {loading ? (
          <div className="node-detail-panel__empty">{t('workspaceNodes.loadingNode')}</div>
        ) : error ? (
          <div className="node-detail-panel__empty node-detail-panel__empty--error">{error}</div>
        ) : !node ? (
          <div className="node-detail-panel__empty">{t('workspaceNodes.selectNode')}</div>
        ) : (
          <article className="node-detail-panel__document">
            <header className="node-detail-panel__document-header">
              <span className="workspace-node-type-pill">
                {getNodeTypeLabel(node.type, t, t('workspaceNodes.genericNode'))}
              </span>
              <NodeTitleEditor
                node={node}
                workspaceId={workspaceId}
                fallbackTitle={t('workspaceNodes.untitled')}
                readOnly={readOnly}
                onNodePatched={onNodePatched}
              />
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
            </header>

            <div className="node-detail-panel__preview">
              <NodeCanvasPreview
                workspaceId={workspaceId}
                record={node}
                minHeight={mode === 'page' ? 480 : 320}
                readOnly={readOnly}
                onPatched={onNodePatched}
              />
            </div>

            <div className="node-detail-panel__supplementary">
              <details
                key={`${node.id}:backlinks`}
                className="node-detail-panel__disclosure"
              >
                <summary>
                  <ChevronRightIcon className="node-detail-panel__disclosure-chevron" />
                  <span>{t('workspaceNodes.backlinksAndRelated')}</span>
                  <span className="node-detail-panel__disclosure-count">{links.length}</span>
                </summary>
                <div className="node-detail-panel__disclosure-body node-detail-panel__links">
                  {links.length > 0 ? links.map((link, index) => (
                    <div key={`${link.relation}-${link.target.nodeId}-${index}`} className="node-detail-panel__link-row">
                      <span>{link.relation}</span>
                      <strong>{link.title ?? link.target.nodeId}</strong>
                    </div>
                  )) : (
                    <div className="node-detail-panel__disclosure-empty">
                      {t('workspaceNodes.linkCount', { count: 0 })}
                    </div>
                  )}
                </div>
              </details>

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
                  {properties.map(([key, value]) => (
                    <div key={key} className="node-detail-panel__property-row">
                      <span>{key}</span>
                      <strong>{renderPropertyValue(value)}</strong>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          </article>
        )}
      </div>
    </section>
  );
};
