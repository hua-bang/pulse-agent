import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import type { KnowledgeTagDefinition, WorkspaceNodeListItem } from '../../types';
import { useI18n } from '../../i18n';
import { Button, Modal, TextField, useIndexNav } from '../ui';
import { NodeTypeIcon } from '../icons';
import { useAllWorkspaceNodeList } from '../WorkspaceNodes/useWorkspaceNodes';
import { getNodeTitle, getNodeWorkspaceId, isKnowledgeNodeType, matchesSearch, tagName } from '../WorkspaceNodes/utils';
import './node-dock-picker.css';

interface Props {
  workspaces: WorkspaceEntry[];
  onSelect: (node: WorkspaceNodeListItem) => void;
  onClose: () => void;
}

const MAX_RESULTS = 30;

export function filterDockNodes(
  nodes: WorkspaceNodeListItem[],
  tags: KnowledgeTagDefinition[],
  query: string,
): WorkspaceNodeListItem[] {
  const normalized = query.trim().toLowerCase();
  return nodes.filter((node) => {
    if (matchesSearch(node, normalized)) return true;
    return node.tags.some((id) => tagName(id, tags).toLowerCase().includes(normalized));
  }).slice(0, MAX_RESULTS);
}

export const NodeDockPicker = ({ workspaces, onSelect, onClose }: Props) => {
  const { t } = useI18n();
  const { nodes, tags, loading, error } = useAllWorkspaceNodeList(workspaces);
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const { index, setIndex, move, reset } = useIndexNav();
  const results = useMemo(() => filterDockNodes(nodes, tags, query), [nodes, tags, query]);

  useEffect(() => reset(0), [query, reset]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-node-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const choose = (node: WorkspaceNodeListItem) => {
    onSelect(node);
    onClose();
  };

  return (
    <Modal open onClose={onClose} width={520} labelledBy="dock-node-picker-title" className="node-dock-picker">
      <div className="node-dock-picker__header">
        <h2 id="dock-node-picker-title">{t('rightDock.openNode')}</h2>
        <TextField
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); move(1, results.length); }
            if (event.key === 'ArrowUp') { event.preventDefault(); move(-1, results.length); }
            if (event.key === 'Enter' && results[index]) choose(results[index]);
          }}
          placeholder={t('rightDock.searchNodes')}
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="dock-node-picker-results"
          aria-activedescendant={results[index] ? `dock-node-option-${index}` : undefined}
        />
      </div>
      <div id="dock-node-picker-results" ref={listRef} className="node-dock-picker__results" role="listbox">
        {loading ? (
          <div className="node-dock-picker__empty">{t('rightDock.loadingNodes')}</div>
        ) : error ? (
          <div className="node-dock-picker__empty">{t('rightDock.loadNodesFailed')}</div>
        ) : results.length === 0 ? (
          <div className="node-dock-picker__empty">{t('rightDock.noNodesFound')}</div>
        ) : results.map((node, nodeIndex) => (
          <Button
            key={`${getNodeWorkspaceId(node)}:${node.id}`}
            id={`dock-node-option-${nodeIndex}`}
            variant="secondary"
            size="sm"
            role="option"
            aria-selected={nodeIndex === index}
            data-node-index={nodeIndex}
            className={`node-dock-picker__item${nodeIndex === index ? ' node-dock-picker__item--active' : ''}`}
            onMouseEnter={() => setIndex(nodeIndex)}
            onFocus={() => setIndex(nodeIndex)}
            onClick={() => choose(node)}
          >
            <NodeTypeIcon type={isKnowledgeNodeType(node.type) ? node.type : 'file'} size={16} />
            <span className="node-dock-picker__copy">
              <strong>{getNodeTitle(node, t('workspaceNodes.untitled'))}</strong>
              <small>{node.workspaceName}</small>
            </span>
            {node.tags.length > 0 && <span className="node-dock-picker__tags">{node.tags.slice(0, 2).map((id) => tagName(id, tags)).join(' · ')}</span>}
          </Button>
        ))}
      </div>
    </Modal>
  );
};
