import { NodeDetailPanel } from './NodeDetailPanel';
import { useKnowledgeTags, useWorkspaceNode, useWorkspaceNodeList } from './useWorkspaceNodes';
import { useI18n } from '../../i18n';
import { Button } from '../ui';
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
  const { t } = useI18n();
  const { node, loading, error, setNode } = useWorkspaceNode(workspaceId, nodeId);
  const { tags, reload: reloadTags } = useKnowledgeTags();
  const { nodes: relationCandidates, tags: workspaceTags, reload: reloadWorkspaceNodes } = useWorkspaceNodeList(workspaceId);
  return (
    <main className="workspace-node-detail-page">
      <header className="workspace-node-detail-page__top">
        <Button size="sm" onClick={onBack}>{t('workspaceNodes.backToNodes')}</Button>
      </header>
      <div className="workspace-node-detail-page__body">
        <NodeDetailPanel
          node={node}
          workspaceId={workspaceId}
          loading={loading}
          error={error}
          mode="page"
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
