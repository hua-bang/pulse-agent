import type { CanvasNode } from '../../types';
import { getNodeDisplayLabel } from '../../utils/nodeLabel';
import type { NodeReferenceEntry, ReferenceEntry } from './types';
import { getReferenceId, getUrlHostname, getUrlReferenceLabel, isUrlReference } from './utils';

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
}: ReferenceEntryListProps) => (
  <ul className="reference-group-items">
    {entries.map((entry) => {
      const id = getReferenceId(entry);
      const node = isUrlReference(entry) ? undefined : getNodeByEntry(entry);
      const label = isUrlReference(entry)
        ? getUrlReferenceLabel(entry)
        : node
          ? getNodeDisplayLabel(node)
          : entry.titleSnapshot ?? entry.nodeId;
      const type = isUrlReference(entry) ? 'url' : node?.type ?? entry.typeSnapshot ?? 'missing';
      const active = id === activeId;
      const workspaceLabel = isUrlReference(entry)
        ? getUrlHostname(entry.url)
        : entry.workspaceId === activeWorkspaceId
          ? 'Current'
          : workspaceNameById.get(entry.workspaceId) ?? entry.workspaceNameSnapshot ?? 'Workspace';

      return (
        <li key={id}>
          <button
            type="button"
            className={`reference-group-item${active ? ' reference-group-item--active' : ''}`}
            onClick={() => onSelect(id)}
            onDoubleClick={() => isUrlReference(entry) ? onOpenUrl(entry.url) : onFocus(entry.workspaceId, entry.nodeId)}
          >
            <span className="reference-group-item-label" title={label}>
              {label}
            </span>
            <span className="reference-group-item-meta" title={workspaceLabel}>{workspaceLabel}</span>
            <span className="reference-group-item-type">{type}</span>
            <span
              className="reference-group-item-remove"
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onRemove(id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onRemove(id);
                }
              }}
              aria-label="Remove from references"
              title="Remove"
            >
              x
            </span>
          </button>
        </li>
      );
    })}
  </ul>
);
