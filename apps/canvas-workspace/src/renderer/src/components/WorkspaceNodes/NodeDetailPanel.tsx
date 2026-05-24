import { useState } from 'react';
import type { KnowledgeTagDefinition, WorkspaceNodeRecord } from '../../types';
import { NodeCanvasPreview } from './NodeCanvasPreview';
import { NodeTagEditor } from './NodeTagEditor';
import { getNodeTags, getNodeTitle, getNodeTypeLabel, formatTime } from './utils';

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
  const tags = getNodeTags(node);
  const properties = propertyEntries(node);
  const [propertiesOpen, setPropertiesOpen] = useState(true);

  if (loading) {
    return (
      <section className={`node-detail-panel node-detail-panel--${mode}`}>
        <div className="node-detail-panel__empty">Loading node...</div>
      </section>
    );
  }

  if (error) {
    return (
      <section className={`node-detail-panel node-detail-panel--${mode}`}>
        <div className="node-detail-panel__empty node-detail-panel__empty--error">{error}</div>
      </section>
    );
  }

  if (!node) {
    return (
      <section className={`node-detail-panel node-detail-panel--${mode}`}>
        <div className="node-detail-panel__empty">Select a node to inspect its details.</div>
      </section>
    );
  }

  return (
    <section className={`node-detail-panel node-detail-panel--${mode}`}>
      <header className="node-detail-panel__header">
        <div className="node-detail-panel__title">
          <span className="workspace-node-type-pill">{getNodeTypeLabel(node.type)}</span>
          <h2 title={getNodeTitle(node)}>{getNodeTitle(node)}</h2>
        </div>
        <div className="node-detail-panel__header-actions">
          {mode === 'drawer' && onOpenPage && (
            <button className="workspace-node-button" onClick={() => onOpenPage(node.id)}>Full</button>
          )}
          {onClose && (
            <button className="workspace-node-icon-button" onClick={onClose} aria-label="Close node detail">x</button>
          )}
        </div>
      </header>

      <div className="node-detail-panel__content">
        <section className="node-detail-panel__section node-detail-panel__section--collapsible">
          <button
            type="button"
            className="node-detail-panel__section-toggle"
            aria-expanded={propertiesOpen}
            onClick={() => setPropertiesOpen((v) => !v)}
          >
            <svg
              className={`node-detail-panel__chevron${propertiesOpen ? ' is-open' : ''}`}
              width="10"
              height="10"
              viewBox="0 0 10 10"
              aria-hidden
            >
              <path d="M3 2.5 L6.5 5 L3 7.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Properties</span>
          </button>
          <div className={`node-detail-panel__collapse${propertiesOpen ? ' is-open' : ''}`}>
            <div className="node-detail-panel__collapse-inner">
              <div className="node-detail-panel__property-row node-detail-panel__property-row--tags">
                <span>Tags</span>
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
              <div className="node-detail-panel__property-row">
                <span>Updated</span>
                <strong>{formatTime(node.updatedAt)}</strong>
              </div>
              {properties.map(([key, value]) => (
                <div key={key} className="node-detail-panel__property-row">
                  <span>{key}</span>
                  <strong>{renderPropertyValue(value)}</strong>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="node-detail-panel__preview">
          <NodeCanvasPreview
            workspaceId={workspaceId}
            record={node}
            minHeight={mode === 'page' ? 480 : 280}
            readOnly={readOnly}
            onPatched={onNodePatched}
          />
        </div>

        {node.links && node.links.length > 0 && (
          <section className="node-detail-panel__section">
            <div className="node-detail-panel__section-title">
              <span>Links</span>
            </div>
            <div className="node-detail-panel__links">
              {node.links.map((link, index) => (
                <div key={`${link.relation}-${link.target.nodeId}-${index}`} className="node-detail-panel__link-row">
                  <span>{link.relation}</span>
                  <strong>{link.title ?? link.target.nodeId}</strong>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </section>
  );
};
