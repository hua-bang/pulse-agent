import type { RefObject } from 'react';
import type { WorkspaceNodeListItem, WorkspaceNodeRecord } from '../../../types';
import { useI18n } from '../../../i18n';
import { CloseIcon } from '../../../components/icons';
import { Button, Popover } from '../../../components/ui';
import { NodeDetailPropertyRows } from './NodeDetailPropertyRows';
import { NodeRelationEditor } from './NodeRelationEditor';

interface Props {
  anchorRef: RefObject<HTMLElement>;
  candidates: WorkspaceNodeListItem[];
  dateLocale: string;
  node: WorkspaceNodeRecord;
  onClose: () => void;
  onNodePatched?: (next: WorkspaceNodeRecord) => void;
  panelId: string;
  readOnly: boolean;
  source: string;
  workspaceId: string;
}

export const NodeDetailInspector = ({
  anchorRef,
  candidates,
  dateLocale,
  node,
  onClose,
  onNodePatched,
  panelId,
  readOnly,
  source,
  workspaceId,
}: Props) => {
  const { t } = useI18n();
  const links = node.links ?? [];
  const properties = Object.entries(node.properties ?? {})
    .filter(([key]) => key !== 'tags' && key !== 'source' && key !== 'aiSummary');
  const closeAndRestoreFocus = () => {
    onClose();
    window.requestAnimationFrame(() => anchorRef.current?.focus());
  };

  return (
    <Popover
      anchorRef={anchorRef}
      align="end"
      onClose={(reason) => {
        if (reason === 'escape') closeAndRestoreFocus();
        else onClose();
      }}
      role="region"
      autoFocus={false}
      keyboardNavigation={false}
      ariaLabel={t('workspaceNodes.info')}
      panelId={panelId}
      className="node-detail-panel__inspector"
    >
      <div className="node-detail-panel__inspector-header">
        <strong>{t('workspaceNodes.info')}</strong>
        <Button variant="icon" size="xs" aria-label={t('shell.close')} onClick={closeAndRestoreFocus}>
          <CloseIcon size={13} />
        </Button>
      </div>
      {source && (
        <section className="node-detail-panel__inspector-section">
          <h2>{t('workspaceNodes.source')}</h2>
          <p className="node-detail-panel__source" title={source}>{source}</p>
        </section>
      )}
      <section className="node-detail-panel__inspector-section">
        <div className="node-detail-panel__rail-heading">
          <h2>{t('workspaceNodes.relations.title')}</h2>
          <span>{links.length}</span>
        </div>
        <NodeRelationEditor
          node={node}
          workspaceId={workspaceId}
          candidates={candidates}
          readOnly={readOnly}
          onNodePatched={onNodePatched}
        />
      </section>
      <section className="node-detail-panel__inspector-section">
        <h2>{t('workspaceNodes.info')}</h2>
        <NodeDetailPropertyRows dateLocale={dateLocale} node={node} properties={properties} />
      </section>
    </Popover>
  );
};
