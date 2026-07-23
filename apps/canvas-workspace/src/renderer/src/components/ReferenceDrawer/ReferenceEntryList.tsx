import type { CanvasNode } from '../../types';
import { getNodeDisplayLabel } from '../../utils/nodeLabel';
import { CANVAS_NODE_TYPE_LABEL_KEY } from '../../utils/nodeTypeI18n';
import { useI18n } from '../../i18n';
import type { NodeReferenceEntry, ReferenceEntry } from './types';
import { getReferenceId, getUrlHostname, getUrlReferenceLabel, isArtifactReference, isUrlReference } from './utils';

interface ReferenceEntryListProps {
  entries: ReferenceEntry[];
  activeWorkspaceId: string;
  workspaceNameById: Map<string, string>;
  getNodeByEntry: (entry: NodeReferenceEntry) => CanvasNode | undefined;
  activeId?: string;
  onSelect: (referenceId: string | undefined) => void;
  onFocus: (workspaceId: string, nodeId: string) => void;
  onOpenUrl: (url: string) => void;
  onRemove: (referenceId: string) => void;
}

export const ReferenceEntryList = ({
  entries,
  activeWorkspaceId,
  workspaceNameById,
  getNodeByEntry,
  activeId,
  onSelect,
  onFocus,
  onOpenUrl,
  onRemove,
}: ReferenceEntryListProps) => {
  const { t } = useI18n();

  return (
    <ul className="reference-group-items">
      {entries.map((entry) => {
        const id = getReferenceId(entry);
        const node = !isUrlReference(entry) && !isArtifactReference(entry) ? getNodeByEntry(entry) : undefined;
        const label = isUrlReference(entry)
          ? getUrlReferenceLabel(entry)
          : isArtifactReference(entry)
            ? entry.titleSnapshot ?? entry.artifactId
            : node
              ? getNodeDisplayLabel(node)
              : entry.titleSnapshot ?? entry.nodeId;
        const type = isUrlReference(entry) || isArtifactReference(entry)
          ? entry.kind
          : node?.type ?? entry.typeSnapshot ?? 'missing';
        const active = id === activeId;
        const workspaceLabel = isUrlReference(entry)
          ? getUrlHostname(entry.url)
          : entry.workspaceId === activeWorkspaceId
            ? t('reference.current')
            : workspaceNameById.get(entry.workspaceId)
              ?? (isArtifactReference(entry) ? t('reference.artifactScopeGlobal') : entry.workspaceNameSnapshot)
              ?? t('reference.workspace');
        const typeLabel = type === 'url'
          ? t('reference.group.url')
          : type === 'artifact'
            ? t('reference.group.artifact')
            : type === 'missing'
              ? t('reference.group.missing')
              : t(CANVAS_NODE_TYPE_LABEL_KEY[type]);

        return (
          <li key={id} className="reference-group-item-row">
            <button
              type="button"
              className={`reference-group-item${active ? ' reference-group-item--active' : ''}`}
              onClick={() => onSelect(id)}
              onDoubleClick={() => {
                if (isUrlReference(entry)) onOpenUrl(entry.url);
                else if (!isArtifactReference(entry)) onFocus(entry.workspaceId, entry.nodeId);
              }}
            >
              <span className="reference-group-item-label" title={label}>
                {label}
              </span>
              <span className="reference-group-item-meta" title={workspaceLabel}>{workspaceLabel}</span>
              <span className="reference-group-item-type">{typeLabel}</span>
            </button>
            <button
              className="reference-group-item-remove"
              type="button"
              onClick={() => onRemove(id)}
              aria-label={t('reference.remove')}
              title={t('reference.remove')}
            >
              x
            </button>
          </li>
        );
      })}
    </ul>
  );
};
