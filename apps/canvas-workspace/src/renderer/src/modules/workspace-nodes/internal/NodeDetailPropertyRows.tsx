import type { WorkspaceNodeRecord } from '../../../types';
import { useI18n } from '../../../i18n';
import { renderNodePropertyValue } from './nodeDetailProperties';
import { formatTime } from './utils';

interface Props {
  dateLocale: string;
  node: WorkspaceNodeRecord;
  properties: Array<[string, unknown]>;
}

export const NodeDetailPropertyRows = ({ dateLocale, node, properties }: Props) => {
  const { t } = useI18n();

  return (
    <>
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
      {properties.map(([key, value]) => (
        <div key={key} className="node-detail-panel__property-row">
          <span>{key}</span>
          <strong>{renderNodePropertyValue(value)}</strong>
        </div>
      ))}
    </>
  );
};
