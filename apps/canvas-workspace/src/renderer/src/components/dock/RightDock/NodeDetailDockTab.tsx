import { useEffect } from 'react';
import { NodeDetailPanel } from '../../../modules/workspace-nodes/detail';
import { getNodeTitle, useKnowledgeTags, useWorkspaceNode, useWorkspaceNodeList } from '../../../modules/workspace-nodes';
import { useI18n } from '../../../i18n';
import type { AgentContextTabRef } from '../../../types';
import type { ChatDeliveryReceipt } from '../../../modules/chat';
import { TabChatAction } from './TabChatAction';

interface NodeDetailDockTabProps {
  workspaceId: string;
  nodeId: string;
  onTitleChange: (title: string) => void;
  onOpenPage: () => void;
  onClose: () => void;
  tabRef?: AgentContextTabRef;
  targetWorkspaceId?: string;
  onAddTabToChat?: (workspaceId: string, tab: AgentContextTabRef) => Promise<ChatDeliveryReceipt>;
}

export const NodeDetailDockTab = ({
  workspaceId,
  nodeId,
  onTitleChange,
  onOpenPage,
  onClose,
  tabRef,
  targetWorkspaceId,
  onAddTabToChat,
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
    const title = node ? getNodeTitle(node, t('workspaceNodes.untitled')) : '';
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
      {tabRef && targetWorkspaceId && onAddTabToChat && (
        <div className="node-detail-dock-tab__chat-action">
          <TabChatAction
            tab={tabRef}
            targetWorkspaceId={targetWorkspaceId}
            onAddToChat={onAddTabToChat}
          />
        </div>
      )}
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
