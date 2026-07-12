import { useEffect } from 'react';
import { NodeDetailPanel } from '../WorkspaceNodes/NodeDetailPanel';
import { useKnowledgeTags, useWorkspaceNode, useWorkspaceNodeList } from '../WorkspaceNodes/useWorkspaceNodes';

interface NodeDetailDockTabProps {
  workspaceId: string;
  nodeId: string;
  onTitleChange: (title: string) => void;
}

export const NodeDetailDockTab = ({
  workspaceId,
  nodeId,
  onTitleChange,
}: NodeDetailDockTabProps) => {
  const { node, loading, error, setNode } = useWorkspaceNode(workspaceId, nodeId);
  const { tags, reload: reloadTags } = useKnowledgeTags();
  const {
    nodes: relationCandidates,
    tags: workspaceTags,
    reload: reloadWorkspaceNodes,
  } = useWorkspaceNodeList(workspaceId);

  useEffect(() => {
    const title = node?.title?.trim();
    if (title) onTitleChange(title);
  }, [node?.title, onTitleChange]);

  return (
    <NodeDetailPanel
      node={node}
      workspaceId={workspaceId}
      loading={loading}
      error={error}
      mode="dock"
      tagDefinitions={[...workspaceTags, ...tags]}
      relationCandidates={relationCandidates}
      onNodePatched={setNode}
      onTagsChanged={() => {
        void reloadTags();
        void reloadWorkspaceNodes();
      }}
    />
  );
};
