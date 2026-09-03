import type { WorkspaceNodeListItem, WorkspaceNodeRecord } from '../../../types';
import { useI18n } from '../../../i18n';
import { ChevronRightIcon } from '../../../components/icons';
import { NodeDetailPropertyRows } from './NodeDetailPropertyRows';
import { NodeRelationEditor } from './NodeRelationEditor';

interface Props {
  candidates: WorkspaceNodeListItem[];
  dateLocale: string;
  infoProperties: Array<[string, unknown]>;
  mode: 'page' | 'dock';
  node: WorkspaceNodeRecord;
  onNodePatched?: (next: WorkspaceNodeRecord) => void;
  readOnly: boolean;
  workspaceId: string;
}

export const NodeDetailSupplementary = ({
  candidates,
  dateLocale,
  infoProperties,
  mode,
  node,
  onNodePatched,
  readOnly,
  workspaceId,
}: Props) => {
  const { t } = useI18n();
  const links = node.links ?? [];

  return (
    <div className="node-detail-panel__supplementary">
      {mode === 'dock' && (
        <details key={`${node.id}:relations`} className="node-detail-panel__disclosure">
          <summary>
            <ChevronRightIcon className="node-detail-panel__disclosure-chevron" />
            <span>{t('workspaceNodes.relations.title')}</span>
            <span className="node-detail-panel__disclosure-count">{links.length}</span>
          </summary>
          <div className="node-detail-panel__disclosure-body">
            <NodeRelationEditor
              node={node}
              workspaceId={workspaceId}
              candidates={candidates}
              readOnly={readOnly}
              onNodePatched={onNodePatched}
            />
          </div>
        </details>
      )}
      <details key={`${node.id}:info`} className="node-detail-panel__disclosure">
        <summary>
          <ChevronRightIcon className="node-detail-panel__disclosure-chevron" />
          <span>{t('workspaceNodes.info')}</span>
        </summary>
        <div className="node-detail-panel__disclosure-body">
          <NodeDetailPropertyRows dateLocale={dateLocale} node={node} properties={infoProperties} />
        </div>
      </details>
    </div>
  );
};
