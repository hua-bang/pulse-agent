import { useEffect } from 'react';
import { NodeDetailPanel } from './NodeDetailPanel';
import { useKnowledgeTags, useWorkspaceNode, useWorkspaceNodeList } from './useWorkspaceNodes';
import { useAppShell } from '../../../components/shell/AppShellProvider';
import { isImeComposing } from '../../../utils/ime';
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
  const { node, loading, error, missing, setNode, reload } = useWorkspaceNode(workspaceId, nodeId);
  const { tags, reload: reloadTags } = useKnowledgeTags();
  const { nodes: relationCandidates, tags: workspaceTags, reload: reloadWorkspaceNodes } = useWorkspaceNodeList(workspaceId);
  const { isOverlayOpen } = useAppShell();

  // Escape leaves this drill-down the way its own Back control does — back to
  // the list it was opened from, never straight to the canvas. Lives here
  // rather than in App's global shortcut block because this route unmounts
  // when it is not active, which is exactly the condition the handler needs.
  // Bubble phase and target-gated: an open picker (capture-phase
  // `useEscapeClose`) and any text/contenteditable field keep their own Escape.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isOverlayOpen || isImeComposing(event)) return;
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return;
      onBack();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOverlayOpen, onBack]);

  return (
    <main className="workspace-node-detail-page">
      <div className="workspace-node-detail-page__body">
        <NodeDetailPanel
          node={node}
          workspaceId={workspaceId}
          loading={loading}
          error={error}
          missing={missing}
          mode="page"
          onBack={onBack}
          onRetry={() => { void reload(); }}
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
