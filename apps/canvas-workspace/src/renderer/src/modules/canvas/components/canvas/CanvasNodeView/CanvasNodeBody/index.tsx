import { lazy, Suspense } from 'react';
import type {
  AgentContextDomReviewComment,
  AgentContextDomSelectionRef,
  CanvasNode,
} from '../../../../../../types';
import type { ChatDeliveryReceipt } from '../../../../../chat';
import { DynamicAppNodeBody } from '../../../node-bodies/DynamicAppNodeBody';
import { PluginNodeBody } from '../../../node-bodies/PluginNodeBody';
import './index.css';

const AgentNodeBody = lazy(() => import('../../../../../coding-agent/surface')
  .then((module) => ({ default: module.AgentNodeBody })));
const FileNodeBody = lazy(() => import('../../../node-bodies/FileNodeBodyLazy')
  .then((module) => ({ default: module.FileNodeBodyLazy })));
const FrameNodeBody = lazy(() => import('../../../node-bodies/FrameNodeBody')
  .then((module) => ({ default: module.FrameNodeBody })));
const IframeNodeBody = lazy(() => import('../../../node-bodies/IframeNodeBody')
  .then((module) => ({ default: module.IframeNodeBody })));
const TerminalNodeBody = lazy(() => import('../../../node-bodies/TerminalNodeBody')
  .then((module) => ({ default: module.TerminalNodeBody })));
const TextNodeBody = lazy(() => import('../../../node-bodies/TextNodeBodyLazy')
  .then((module) => ({ default: module.TextNodeBodyLazy })));

interface Props {
  node: CanvasNode;
  getAllNodes?: () => CanvasNode[];
  rootFolder?: string;
  workspaceId?: string;
  workspaceName?: string;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void | Promise<void>;
  onRemoveNodes?: (ids: string[]) => void;
  onSelect: (id: string, mods?: { shift?: boolean; meta?: boolean }) => void;
  onDragStart: (event: React.MouseEvent, node: CanvasNode) => void;
  onAddDomSelectionToChat?: (
    selection: AgentContextDomSelectionRef,
  ) => Promise<ChatDeliveryReceipt>;
  onSubmitDomReviewComments?: (
    comments: AgentContextDomReviewComment[],
  ) => Promise<boolean>;
  isSelected: boolean;
  isResizing: boolean;
  renderFullFileBody: boolean;
  readOnly: boolean;
}

export const CanvasNodeBody = ({
  node,
  getAllNodes,
  rootFolder,
  workspaceId,
  workspaceName,
  onUpdate,
  onRemoveNodes,
  onSelect,
  onDragStart,
  onAddDomSelectionToChat,
  onSubmitDomReviewComments,
  isSelected,
  isResizing,
  renderFullFileBody,
  readOnly,
}: Props) => (
  <Suspense fallback={null}>
    {node.type === 'file' ? (
      <FileNodeBody
        node={node}
        onUpdate={onUpdate}
        workspaceId={workspaceId}
        getAllNodes={getAllNodes}
        readOnly={readOnly}
        renderFullEditor={renderFullFileBody}
      />
    ) : node.type === 'terminal' ? (
      <TerminalNodeBody
        node={node}
        getAllNodes={getAllNodes}
        rootFolder={rootFolder}
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        onUpdate={onUpdate}
        readOnly={readOnly}
      />
    ) : node.type === 'frame' || node.type === 'group' ? (
      <FrameNodeBody
        node={node}
        getAllNodes={getAllNodes}
        onUpdate={onUpdate}
        onRemoveNodes={onRemoveNodes}
        rootFolder={rootFolder}
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        readOnly={readOnly}
      />
    ) : node.type === 'text' ? (
      <TextNodeBody
        node={node}
        onUpdate={onUpdate}
        isSelected={isSelected}
        isResizing={isResizing}
        onSelect={onSelect}
        onDragStart={onDragStart}
        readOnly={readOnly}
      />
    ) : node.type === 'iframe' ? (
      <IframeNodeBody
        node={node}
        workspaceId={workspaceId}
        onUpdate={onUpdate}
        isResizing={isResizing}
        onAddDomSelectionToChat={onAddDomSelectionToChat}
        onSubmitDomReviewComments={onSubmitDomReviewComments}
        readOnly={readOnly}
      />
    ) : node.type === 'dynamic-app' ? (
      <DynamicAppNodeBody
        node={node}
        workspaceId={workspaceId}
        onUpdate={onUpdate}
        isResizing={isResizing}
        readOnly={readOnly}
      />
    ) : node.type === 'plugin' ? (
      <PluginNodeBody
        node={node}
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        onUpdate={onUpdate}
        isSelected={isSelected}
        readOnly={readOnly}
      />
    ) : (
      <AgentNodeBody
        node={node}
        getAllNodes={getAllNodes}
        rootFolder={rootFolder}
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        onUpdate={onUpdate}
        readOnly={readOnly}
      />
    )}
  </Suspense>
);
