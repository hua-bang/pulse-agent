import { NodeDetailPanel } from './NodeDetailPanel';
import { useKnowledgeTags, useWorkspaceNode, useWorkspaceNodeList } from './useWorkspaceNodes';
import './index.css';

interface NodeDetailPageProps {
  workspaceId: string;
  nodeId: string | null;
  onBack: () => void;
}

export const NodeDetailPage = ({
  workspaceId,
  nodeId,
  onBack,
}: NodeDetailPageProps) => {
  const { node, loading, error, setNode } = useWorkspaceNode(workspaceId, nodeId);
  const { tags, reload: reloadTags } = useKnowledgeTags();
  const { nodes: relationCandidates, tags: workspaceTags, reload: reloadWorkspaceNodes } = useWorkspaceNodeList(workspaceId);
  return (
    <main className="workspace-node-detail-page">
      <div className="workspace-node-detail-page__body">
        <NodeDetailPanel
          node={node}
          workspaceId={workspaceId}
          loading={loading}
          error={error}
          mode="page"
          onBack={onBack}
          tagDefinitions={[...workspaceTags, ...tags]}
          relationCandidates={relationCandidates}
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
