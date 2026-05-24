import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import { NodeDetailPanel } from './NodeDetailPanel';
import { useKnowledgeTags, useWorkspaceNode, useWorkspaceNodeList } from './useWorkspaceNodes';

interface NodeDetailPageProps {
  workspaceId: string;
  nodeId: string | null;
  workspaces: WorkspaceEntry[];
  onBack: () => void;
}

export const NodeDetailPage = ({
  workspaceId,
  nodeId,
  workspaces,
  onBack,
}: NodeDetailPageProps) => {
  const { node, loading, error, setNode } = useWorkspaceNode(workspaceId, nodeId);
  const { tags, reload: reloadTags } = useKnowledgeTags();
  const { tags: workspaceTags, reload: reloadWorkspaceNodes } = useWorkspaceNodeList(workspaceId);
  const workspace = workspaces.find((item) => item.id === workspaceId);

  return (
    <main className="workspace-node-detail-page">
      <header className="workspace-node-detail-page__top">
        <button className="workspace-node-button" onClick={onBack}>Back to Nodes</button>
        <span>{workspace?.name ?? workspaceId}</span>
      </header>
      <div className="workspace-node-detail-page__body">
        <NodeDetailPanel
          node={node}
          workspaceId={workspaceId}
          loading={loading}
          error={error}
          mode="page"
          tagDefinitions={[...workspaceTags, ...tags]}
          onNodePatched={(next) => setNode(next)}
          onTagsChanged={() => {
            void reloadTags();
            void reloadWorkspaceNodes();
          }}
        />
      </div>
    </main>
  );
};
