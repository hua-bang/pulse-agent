import { useEffect } from 'react';
import { NodeDetailPanel } from '../WorkspaceNodes/NodeDetailPanel';
import { useKnowledgeTags, useWorkspaceNode, useWorkspaceNodeList } from '../WorkspaceNodes/useWorkspaceNodes';
import { useI18n } from '../../i18n';
import { Button } from '../ui';

interface NodeDetailDockTabProps {
  workspaceId: string;
  nodeId: string;
  onTitleChange: (title: string) => void;
  onOpenPage: () => void;
}

export const NodeDetailDockTab = ({
  workspaceId,
  nodeId,
  onTitleChange,
  onOpenPage,
}: NodeDetailDockTabProps) => {
  const { t } = useI18n();
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
    <section className="node-detail-dock-tab">
      <header className="node-detail-dock-tab__toolbar">
        <Button size="sm" onClick={onOpenPage}>{t('workspaceNodes.goToDetail')}</Button>
      </header>
      <div className="node-detail-dock-tab__content">
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
      </div>
    </section>
  );
};
