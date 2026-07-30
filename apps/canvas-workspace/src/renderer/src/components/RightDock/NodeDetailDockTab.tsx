import { useEffect } from 'react';
import { NodeDetailPanel } from '../WorkspaceNodes/NodeDetailPanel';
import { useKnowledgeTags, useWorkspaceNode, useWorkspaceNodeList } from '../WorkspaceNodes/useWorkspaceNodes';
import { useI18n } from '../../i18n';

interface NodeDetailDockTabProps {
  workspaceId: string;
  nodeId: string;
  onTitleChange: (title: string) => void;
  onOpenPage: () => void;
  onClose: () => void;
}

export const NodeDetailDockTab = ({
  workspaceId,
  nodeId,
  onTitleChange,
  onOpenPage,
  onClose,
}: NodeDetailDockTabProps) => {
  const { t } = useI18n();
  const { node, loading, error, missing, setNode, reload } = useWorkspaceNode(workspaceId, nodeId);
  const { tags, reload: reloadTags } = useKnowledgeTags();
  const {
    nodes: relationCandidates,
    tags: workspaceTags,
    reload: reloadWorkspaceNodes,
  } = useWorkspaceNodeList(workspaceId);

  useEffect(() => {
    const title = node?.title?.trim();
    if (title) {
      onTitleChange(title);
      return;
    }
    // A node that lost its title — or was deleted out from under this tab —
    // must not leave the tab advertising the old one.
    if (missing || (node && !title)) {
      onTitleChange(t('workspaceNodes.untitled'));
    }
  }, [missing, node, onTitleChange, t]);

  return (
    <section className="node-detail-dock-tab">
      <NodeDetailPanel
        node={node}
        workspaceId={workspaceId}
        loading={loading}
        error={error}
        missing={missing}
        mode="dock"
        tagDefinitions={[...workspaceTags, ...tags]}
        relationCandidates={relationCandidates}
        onNodePatched={setNode}
        onOpenPage={onOpenPage}
        onRetry={() => { void reload(); }}
        onClose={onClose}
        onTagsChanged={() => {
          void reloadTags();
          void reloadWorkspaceNodes();
        }}
      />
    </section>
  );
};
