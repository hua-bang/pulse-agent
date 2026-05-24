import { useMemo, useState } from 'react';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import type { WorkspaceNodeListItem } from '../../types';
import { NodeDetailDrawer } from './NodeDetailDrawer';
import { useAllWorkspaceNodeList } from './useWorkspaceNodes';
import {
  NODE_TYPE_FILTERS,
  type NodeTypeFilter,
  formatTime,
  getNodeSummary,
  getNodeTags,
  getNodeTitle,
  getNodeTypeLabel,
  getNodeWorkspaceId,
  matchesSearch,
  tagName,
  truncateText,
} from './utils';

interface NodesPageProps {
  workspaces: WorkspaceEntry[];
  selectedNode?: { workspaceId: string; nodeId: string } | null;
  onOpenNode: (workspaceId: string, nodeId: string) => void;
  onSelectNode?: (selection: { workspaceId: string; nodeId: string } | null) => void;
}

function filterByType(node: WorkspaceNodeListItem, type: NodeTypeFilter): boolean {
  if (type === 'all') return true;
  if (type === 'untagged') return getNodeTags(node).length === 0;
  return node.type === type;
}

export const NodesPage = ({
  workspaces,
  selectedNode,
  onOpenNode,
  onSelectNode,
}: NodesPageProps) => {
  const { nodes, tags: tagDefinitions, loading, error, reload } = useAllWorkspaceNodeList(workspaces);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<NodeTypeFilter>('all');
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of nodes) {
      for (const tag of getNodeTags(node)) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [nodes]);

  const filteredNodes = useMemo(() => {
    return nodes.filter((node) => {
      if (!matchesSearch(node, query)) return false;
      if (!filterByType(node, typeFilter)) return false;
      if (tagFilter && !getNodeTags(node).includes(tagFilter)) return false;
      return true;
    });
  }, [nodes, query, typeFilter, tagFilter]);

  const tagLabel = (tagId: string) => tagName(tagId, tagDefinitions);

  return (
    <main className="workspace-nodes-page">
      <section className="workspace-nodes-page__main">
        <div className="workspace-nodes-page__top">
          <header className="workspace-nodes-page__header">
            <div>
              <h1>Nodes</h1>
              <p>Knowledge library · {nodes.length} items</p>
            </div>
            <div className="workspace-nodes-page__header-actions">
              <button className="workspace-node-button" onClick={() => void reload()}>Refresh</button>
            </div>
          </header>

          <div className="workspace-nodes-toolbar">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search title, content, tags..."
              className="workspace-nodes-search"
            />
            <div className="workspace-nodes-filter-row">
              {NODE_TYPE_FILTERS.map((type) => (
                <button
                  key={type}
                  className={`workspace-node-chip${typeFilter === type ? ' is-active' : ''}`}
                  onClick={() => setTypeFilter(type)}
                >
                  {type === 'all' ? 'All' : type === 'untagged' ? 'Untagged' : getNodeTypeLabel(type)}
                </button>
              ))}
            </div>
            {tags.length > 0 && (
              <div className="workspace-nodes-filter-row">
                <button
                  className={`workspace-node-chip${tagFilter === null ? ' is-active' : ''}`}
                  onClick={() => setTagFilter(null)}
                >
                  All tags
                </button>
                {tags.map(([tag, count]) => (
                  <button
                    key={tag}
                    className={`workspace-node-chip${tagFilter === tag ? ' is-active' : ''}`}
                    onClick={() => setTagFilter(tag)}
                    title={tagDefinitions.find((item) => item.id === tag)?.description}
                  >
                    <span className="workspace-node-chip-dot" />
                    {tagLabel(tag)}
                    <span className="workspace-node-chip-count">{count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="workspace-nodes-page__scroll">
          {error && <div className="workspace-nodes-state workspace-nodes-state--error">{error}</div>}
          {loading && <div className="workspace-nodes-state">Loading nodes...</div>}
          {!loading && filteredNodes.length === 0 && (
            <div className="workspace-nodes-empty">
              <h2>No nodes found</h2>
              <p>Nodes appear here after a workspace is migrated to v2 or new atomic nodes are created.</p>
            </div>
          )}
          <div className="workspace-node-grid">
            {filteredNodes.map((node) => {
              const tagsForNode = getNodeTags(node);
              const summary = getNodeSummary(node);
              const workspaceIdForNode = getNodeWorkspaceId(node);
              const selected = selectedNode?.workspaceId === workspaceIdForNode && selectedNode.nodeId === node.id;
              return (
                <article
                  key={`${workspaceIdForNode}:${node.id}`}
                  className={`workspace-node-card${selected ? ' is-selected' : ''}`}
                  onClick={() => onSelectNode?.({ workspaceId: workspaceIdForNode, nodeId: node.id })}
                >
                  <div className="workspace-node-card__meta">
                    <span className="workspace-node-type-pill">{getNodeTypeLabel(node.type)}</span>
                    <span>{formatTime(node.updatedAt)}</span>
                  </div>
                  <h2 onClick={(event) => { event.stopPropagation(); onOpenNode(workspaceIdForNode, node.id); }}>{getNodeTitle(node)}</h2>
                  <p>{summary ? truncateText(summary, 180) : 'No preview available.'}</p>
                  <div className="workspace-node-tags">
                    {tagsForNode.length > 0
                      ? tagsForNode.slice(0, 4).map((tag) => <span key={tag} className="workspace-node-tag">{tagLabel(tag)}</span>)
                      : <span className="workspace-node-muted">No tags</span>}
                  </div>
                  <div className="workspace-node-card__footer">
                    <span>{node.workspaceName ?? workspaceIdForNode}</span>
                    {node.linkCount > 0 && <span>{node.linkCount} links</span>}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <NodeDetailDrawer
        workspaceId={selectedNode?.workspaceId ?? ''}
        nodeId={selectedNode?.nodeId ?? null}
        tagDefinitions={tagDefinitions}
        onClose={() => onSelectNode?.(null)}
        onOpenPage={onOpenNode}
        onNodeChanged={() => { void reload(); }}
      />
    </main>
  );
};
