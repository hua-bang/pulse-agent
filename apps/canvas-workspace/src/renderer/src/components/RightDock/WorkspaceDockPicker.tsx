import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import { useI18n } from '../../i18n';
import { Button, Modal, TextField, useIndexNav } from '../ui';
import { NodeTypeIcon } from '../icons';
import './node-dock-picker.css';

interface Props {
  workspaces: WorkspaceEntry[];
  activeWorkspaceId: string;
  onSelect: (workspace: WorkspaceEntry) => void;
  onClose: () => void;
}

const MAX_RESULTS = 50;

export function filterWorkspaces(
  workspaces: WorkspaceEntry[],
  query: string,
): WorkspaceEntry[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return workspaces.slice(0, MAX_RESULTS);
  return workspaces
    .filter((workspace) => workspace.name.toLowerCase().includes(normalized))
    .slice(0, MAX_RESULTS);
}

/**
 * Searchable workspace switcher for the dock's "+" menu. Selecting a workspace
 * opens its canvas (via the app's workspace switch), so the picker is a quick,
 * keyboard-driven alternative to the sidebar list.
 */
export const WorkspaceDockPicker = ({ workspaces, activeWorkspaceId, onSelect, onClose }: Props) => {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const { index, setIndex, move, reset } = useIndexNav();
  const results = useMemo(() => filterWorkspaces(workspaces, query), [workspaces, query]);

  useEffect(() => reset(0), [query, reset]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-ws-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const choose = (workspace: WorkspaceEntry) => {
    // The active workspace is already live (read-write) in the main canvas;
    // previewing it too would mount the same canvas twice. Block it here.
    if (workspace.id === activeWorkspaceId) return;
    onSelect(workspace);
    onClose();
  };

  return (
    <Modal open onClose={onClose} width={520} labelledBy="dock-workspace-picker-title" className="node-dock-picker">
      <div className="node-dock-picker__header">
        <h2 id="dock-workspace-picker-title">{t('rightDock.openCanvas')}</h2>
        <TextField
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); move(1, results.length); }
            if (event.key === 'ArrowUp') { event.preventDefault(); move(-1, results.length); }
            if (event.key === 'Enter' && results[index]) choose(results[index]);
          }}
          placeholder={t('rightDock.searchWorkspaces')}
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="dock-workspace-picker-results"
          aria-activedescendant={results[index] ? `dock-workspace-option-${index}` : undefined}
        />
      </div>
      <div id="dock-workspace-picker-results" ref={listRef} className="node-dock-picker__results" role="listbox">
        {results.length === 0 ? (
          <div className="node-dock-picker__empty">{t('rightDock.noWorkspacesFound')}</div>
        ) : results.map((workspace, wsIndex) => {
          const isActive = workspace.id === activeWorkspaceId;
          return (
            <Button
              key={workspace.id}
              id={`dock-workspace-option-${wsIndex}`}
              variant="secondary"
              size="sm"
              role="option"
              aria-selected={wsIndex === index}
              aria-disabled={isActive}
              disabled={isActive}
              data-ws-index={wsIndex}
              className={`node-dock-picker__item${wsIndex === index ? ' node-dock-picker__item--active' : ''}${isActive ? ' node-dock-picker__item--disabled' : ''}`}
              onMouseEnter={() => setIndex(wsIndex)}
              onFocus={() => setIndex(wsIndex)}
              onClick={() => choose(workspace)}
            >
              <NodeTypeIcon type="frame" size={16} />
              <span className="node-dock-picker__copy">
                <strong>{workspace.name}</strong>
                {workspace.rootFolder && <small>{workspace.rootFolder}</small>}
              </span>
              {isActive && (
                <span className="node-dock-picker__tags">{t('rightDock.canvasOpenInMain')}</span>
              )}
            </Button>
          );
        })}
      </div>
    </Modal>
  );
};
