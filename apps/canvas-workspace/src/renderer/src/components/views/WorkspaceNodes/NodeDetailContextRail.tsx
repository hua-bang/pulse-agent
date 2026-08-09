import type { ReactNode } from 'react';
import type { WorkspaceNodeListItem, WorkspaceNodeRecord } from '../../../types';
import { useI18n } from '../../../i18n';
import { NodeRelationEditor } from './NodeRelationEditor';

interface Props {
  aiInsight: ReactNode;
  candidates: WorkspaceNodeListItem[];
  node: WorkspaceNodeRecord;
  onNodePatched?: (next: WorkspaceNodeRecord) => void;
  readOnly: boolean;
  source: string;
  workspaceId: string;
}

export const NodeDetailContextRail = ({
  aiInsight,
  candidates,
  node,
  onNodePatched,
  readOnly,
  source,
  workspaceId,
}: Props) => {
  const { t } = useI18n();
  const links = node.links ?? [];

  return (
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
          candidates={candidates}
          readOnly={readOnly}
          onNodePatched={onNodePatched}
        />
      </section>
      {aiInsight}
    </aside>
  );
};
