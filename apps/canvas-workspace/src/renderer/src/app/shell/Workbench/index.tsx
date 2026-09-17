import React, { lazy, Suspense, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Canvas } from '../../../modules/canvas/surface';
import { FileNodeEditorRegistryProvider } from '../../../shared/fileNodeEditorRegistry';
import { ChatPanelLazy as ChatPanel } from '../../../modules/chat/lazy';
import { isDockChatVisible, isDockTerminalVisible, useRightDock, useRightDockChatHost, useRightDockState } from '../../../modules/dock';
import { buildDockTabRefs } from '../../../shared/dock/tabRefs';
import type { SettingsSection } from '../../../modules/settings';
import type { WorkspaceEntry } from '../../../shared/workspaces';
import type { WorkbenchController } from './useWorkbenchState';
import type { CanvasNode } from '../../../types';
import { useMountedWorkspaceIds } from './useMountedWorkspaceIds';
import { useChatInsertionBridge } from './useChatInsertionBridge';
import { useEvictAndPreview, usePeekNode, usePreviewNodeActionBridge } from './usePreviewNodeActionBridge';
import { useReferenceEntries } from './useReferenceEntries';
import { useReferenceOperations } from './useReferenceOperations';
import { WorkspaceTerminalPortal } from './WorkspaceTerminalPortal';
import { useLoadedChatWorkspaceIds } from './useLoadedChatWorkspaceIds';
import { ScheduledChatPanel } from '../../../modules/scheduled/surface';
import type { KnowledgeChatRouteContext } from './knowledgeChatContext';
import { useOptionalChatTargetBroker } from '../../../modules/chat';
import type { AgentScope } from '../../../types';
export { useWorkbenchState } from './useWorkbenchState';
export type { WorkbenchController } from './useWorkbenchState';
const EMPTY_CHAT_NODES: CanvasNode[] = [];
const EMPTY_CHAT_SELECTED_NODE_IDS: string[] = [];
const ReferenceDrawer = lazy(() => import('../../../modules/dock/reference').then((m) => ({ default: m.ReferenceDrawer })));
const KnowledgeChatPortal = lazy(() => import('./KnowledgeChatPortal').then((m) => ({ default: m.KnowledgeChatPortal })));
interface WorkbenchProps {
  activeWorkspaceId: string;
  /** PulseRouter keeps Workbench mounted off-route; only the visible canvas
   * route may own global canvas keyboard and paste handlers. */
  canvasHostActive?: boolean;
  workspaces: WorkspaceEntry[];
  controller: WorkbenchController;
  knowledgeChatContext: KnowledgeChatRouteContext;
  onRemoveKnowledgeChatContext?: (key: string) => void; onKnowledgeComposerRequestHandled?: (requestId: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onActivateWorkspace: (workspaceId: string) => void;
  /** Opens the global Settings drawer focused on the given section. */
  onOpenAppSettings: (section: SettingsSection) => void;
  /** Opens the settings drawer for a specific workspace. */
  onOpenWorkspaceSettings: (workspaceId: string) => void;
  onOpenSessionInScope?: (scope: AgentScope, sessionId: string, scopeLabel: string) => void;
  onSetActiveRootFolder: () => void;
}
export const Workbench: React.FC<WorkbenchProps> = ({
  activeWorkspaceId,
  canvasHostActive = true,
  workspaces,
  controller,
  knowledgeChatContext,
  onRemoveKnowledgeChatContext,
  onKnowledgeComposerRequestHandled,
  onSelectWorkspace,
  onActivateWorkspace,
  onOpenAppSettings,
  onOpenWorkspaceSettings,
  onOpenSessionInScope,
  onSetActiveRootFolder,
}) => {
  const {
    allNodes,
    activeNodes,
    activeSelectedNode,
    selectedNodeIdsByWorkspace,
    focusRequest,
    deleteRequest,
    renameRequest,
    handleNodesChange,
    patchNodeSnapshot,
    handleSelectionChange,
    ensureWorkspaceNodesLoaded,
    requestNodeFocus,
    clearFocusRequest,
    clearDeleteRequest,
    clearRenameRequest,
  } = controller;
  const dock = useRightDock();
  const chatTargetBroker = useOptionalChatTargetBroker();
  const dockState = useRightDockState();
  const chatHost = useRightDockChatHost();
  const chatPanelOpen = isDockChatVisible(dockState);
  const scheduledChatTaskId = dockState.scheduledChatTaskId;
  const loadedChatWorkspaceIds = useLoadedChatWorkspaceIds(chatPanelOpen, activeWorkspaceId);
  const terminalDockOpen = isDockTerminalVisible(dockState);
  const { mountedWorkspaceIds, evictWorkspace } = useMountedWorkspaceIds(activeWorkspaceId, workspaces, dockState.terminalTabsByWorkspace);
  // Publish the live-mounted set so the dock never previews an already-live canvas.
  useEffect(() => { dock.setMountedWorkspaces(mountedWorkspaceIds); }, [dock, mountedWorkspaceIds]);
  useEvictAndPreview({ mountedWorkspaceIds, evictWorkspace, terminalTabsByWorkspace: dockState.terminalTabsByWorkspace, openCanvasPreview: dock.openCanvasPreview });
  const {
    activeReference,
    activeReferenceNode,
    clearAllReferences,
    pinReferenceArtifact,
    pinReferenceNode,
    pinReferenceUrl,
    referenceDrawerLoaded,
    referenceDrawerOpen,
    references,
    removeReference,
    setActiveReference,
    setReferenceDrawerOpen,
    updateUrlReferenceTitle,
  } = useReferenceEntries({ activeWorkspaceId, allNodes, workspaces });
  useEffect(() => {
    for (const node of activeNodes) {
      const ref = node.ref;
      if (ref?.kind === 'workspace-node') ensureWorkspaceNodesLoaded(ref.workspaceId);
    }
  }, [activeNodes, ensureWorkspaceNodesLoaded]);
  // Reference "jump to node" peeks at other workspaces in the dock preview
  // instead of yanking the main canvas over (falls back when unpreviewable).
  const peekNode = usePeekNode({ activeWorkspaceId, workspaces, openCanvasPreview: dock.openCanvasPreview, onSelectWorkspace, requestNodeFocus });

  const {
    handleAddDomSelectionToChat,
    handleAddTabToChat,
    handleStartSkillChat,
    handleAddNodeToChat,
    handleAddPreviewNodeToChat,
    handleSubmitDomReviewComments,
    registerInsertDomSelectionMention,
    registerInsertTabMention,
    registerInsertMention,
    registerStartSkillChat,
    registerSubmitDomReviewComments,
  } = useChatInsertionBridge({
    allNodes,
    openChat: dock.openChat,
    deliverToActiveTarget: chatTargetBroker?.deliver,
  });

  useEffect(() => dock.registerPinUrlReference(pinReferenceUrl), [dock, pinReferenceUrl]);

  useEffect(() => dock.registerAddDomSelectionToChat(handleAddDomSelectionToChat), [dock, handleAddDomSelectionToChat]);
  useEffect(() => dock.registerSubmitDomReviewComments(handleSubmitDomReviewComments), [dock, handleSubmitDomReviewComments]);
  useEffect(() => dock.registerAddTabToChat(handleAddTabToChat), [dock, handleAddTabToChat]);
  useEffect(() => dock.registerStartSkillChat((workspaceId, skillName) => {
    if (workspaceId !== activeWorkspaceId) onActivateWorkspace(workspaceId);
    // The bridge invokes an already mounted target composer immediately and
    // otherwise holds the request until that workspace registers its composer.
    handleStartSkillChat(workspaceId, skillName);
  }), [activeWorkspaceId, dock, handleStartSkillChat, onActivateWorkspace]);

  const referenceOperations = useReferenceOperations({
    allNodes,
    workspaces,
    mountedWorkspaceIds,
    patchNodeSnapshot,
    ensureWorkspaceNodesLoaded,
    setReferenceDrawerOpen,
    peekNode,
  });

  usePreviewNodeActionBridge({ activeWorkspaceId, workspaces, addPreviewNodeToChat: handleAddPreviewNodeToChat, pinReferenceNode, addReferenceToCanvas: referenceOperations.addReferenceToCanvas, ensureWorkspaceNodesLoaded });

  return (
    <>
      <FileNodeEditorRegistryProvider>
        {referenceDrawerLoaded && (
          <Suspense fallback={null}>
            <ReferenceDrawer
              open={referenceDrawerOpen}
              activeWorkspaceId={activeWorkspaceId}
              workspaces={workspaces}
              references={references}
              activeReference={activeReference}
              activeReferenceNode={activeReferenceNode}
              nodes={activeNodes}
              allNodes={allNodes}
              selectedNode={activeSelectedNode}
              onOpenChange={setReferenceDrawerOpen}
              onSelectReference={setActiveReference}
              onRemoveReference={removeReference}
              onClearAll={clearAllReferences}
              onAddReference={pinReferenceNode}
              onAddUrlReference={pinReferenceUrl}
              onAddArtifactReference={pinReferenceArtifact}
              onUrlReferenceTitle={updateUrlReferenceTitle}
              onFocusNode={peekNode}
              onAddReferenceToCanvas={referenceOperations.addReferenceToCanvas}
              onWorkspaceNodesRequest={ensureWorkspaceNodesLoaded}
            />
          </Suspense>
        )}
        <div className="canvas-viewport">
          {workspaces.filter((ws) => mountedWorkspaceIds.has(ws.id)).map((ws) => {
            const isActive = ws.id === activeWorkspaceId;
            return (
              <div
                key={ws.id}
                className="canvas-host"
                style={isActive ? undefined : { display: 'none' }}
              >
                <div className="canvas-host__main">
                  <Canvas
                    canvasId={ws.id}
                    canvasName={ws.name}
                    rootFolder={ws.rootFolder}
                    isActive={canvasHostActive && isActive}
                    onNodesChange={handleNodesChange}
                    onSelectionChange={handleSelectionChange}
                    focusNodeId={ws.id === focusRequest?.workspaceId ? focusRequest.nodeId : undefined}
                    onFocusComplete={clearFocusRequest}
                    deleteNodeId={ws.id === deleteRequest?.workspaceId ? deleteRequest.nodeId : undefined}
                    onDeleteComplete={clearDeleteRequest}
                    renameRequest={ws.id === renameRequest?.workspaceId ? renameRequest : undefined}
                    onRenameComplete={clearRenameRequest}
                    chatPanelOpen={chatPanelOpen}
                    onChatOpen={dock.openChat}
                    onChatToggle={dock.toggleChat}
                    referenceDrawerOpen={referenceDrawerOpen}
                    onReferenceToggle={() => setReferenceDrawerOpen((prev) => !prev)}
                    onPinReferenceNode={(nodeId) => pinReferenceNode(ws.id, nodeId)}
                    onAddToChat={(nodeId) => handleAddNodeToChat(ws.id, nodeId)}
                    onAddDomSelectionToChat={(selection) => handleAddDomSelectionToChat(ws.id, selection)}
                    onSubmitDomReviewComments={(comments) => handleSubmitDomReviewComments(ws.id, comments)}
                    resolveReferenceNode={referenceOperations.resolveReferenceNode}
                    onOpenReferenceSource={referenceOperations.handleOpenReferenceSource}
                    onUpdateReferenceSource={referenceOperations.updateReferenceSourceNode}
                    referencePlacementRequest={isActive ? referenceOperations.referencePlacementRequest : null}
                    onReferencePlacementComplete={referenceOperations.consumeReferencePlacementRequest}
                    createReferenceNode={referenceOperations.createReferenceNodeFromEntry}
                    clipboard={referenceOperations.canvasClipboard}
                    onClipboardChange={referenceOperations.setCanvasClipboard}
                    onPasteReferences={referenceOperations.pasteReferencesIntoCanvas}
                    nodePatchRequest={referenceOperations.nodePatchRequest?.workspaceId === ws.id ? referenceOperations.nodePatchRequest : undefined}
                    onNodePatchComplete={referenceOperations.completeNodePatch}
                    onSetRootFolder={onSetActiveRootFolder}
                  />
                </div>
              </div>
            );
          })}
        </div>
        {chatHost && createPortal(
          <>
            {workspaces.filter((ws) => mountedWorkspaceIds.has(ws.id) && loadedChatWorkspaceIds.has(ws.id)).map((ws) => (
              <div
                key={ws.id}
                className="right-dock__chat-instance"
                style={scheduledChatTaskId || knowledgeChatContext.active || ws.id !== activeWorkspaceId ? { display: 'none' } : undefined}
              >
                <ChatPanel
                  workspaceId={ws.id}
                  allWorkspaces={workspaces}
                  nodes={allNodes[ws.id] ?? EMPTY_CHAT_NODES}
                  dockTabs={buildDockTabRefs(dockState, ws.id)}
                  selectedNodeIds={selectedNodeIdsByWorkspace[ws.id] ?? EMPTY_CHAT_SELECTED_NODE_IDS}
                  rootFolder={ws.rootFolder}
                  onClose={dock.collapse}
                  onNodeFocus={(nodeId) => requestNodeFocus(ws.id, nodeId)}
                  onOpenAppSettings={onOpenAppSettings}
                  onOpenWorkspaceSettings={onOpenWorkspaceSettings}
                  onRegisterInsertMention={(fn) => registerInsertMention(ws.id, fn)}
                  onRegisterStartSkillChat={(fn) => registerStartSkillChat(ws.id, fn)}
                  onRegisterInsertDomSelectionMention={(fn) => registerInsertDomSelectionMention(ws.id, fn)}
                  onRegisterInsertTabMention={(fn) => registerInsertTabMention(ws.id, fn)}
                  onRegisterSubmitDomReviewComments={(fn) => registerSubmitDomReviewComments(ws.id, fn)}
                  onTurnComplete={dock.notifyChatActivity}
                  chatTargetActive={chatPanelOpen
                    && !scheduledChatTaskId
                    && !knowledgeChatContext.active
                    && ws.id === activeWorkspaceId}
                  chatTargetLabel={ws.name}
                  onOpenSessionInScope={onOpenSessionInScope}
                />
              </div>
            ))}
            {scheduledChatTaskId && (
              <div className="right-dock__chat-instance">
                <ScheduledChatPanel
                  taskId={scheduledChatTaskId}
                  revision={dockState.scheduledChatRevision ?? 0}
                  allWorkspaces={workspaces}
                  onClose={dock.collapse}
                  onOpenAppSettings={onOpenAppSettings}
                  onTurnComplete={dock.notifyChatActivity}
                  chatTargetActive={chatPanelOpen}
                  onOpenSessionInScope={onOpenSessionInScope}
                />
              </div>
            )}
            {!scheduledChatTaskId && knowledgeChatContext.active && (
              <Suspense fallback={null}>
                <KnowledgeChatPortal
                  selectedNode={knowledgeChatContext.selectedNode}
                  workspaces={workspaces}
                  contextNodes={knowledgeChatContext.explicitContext?.nodes}
                  contextTags={knowledgeChatContext.explicitContext?.tags}
                  contextCanvases={knowledgeChatContext.explicitContext?.canvases}
                  composerRequest={knowledgeChatContext.explicitContext?.composerRequest}
                  onComposerRequestHandled={onKnowledgeComposerRequestHandled}
                  onRemoveContext={onRemoveKnowledgeChatContext}
                  onClose={dock.collapse}
                  onOpenAppSettings={onOpenAppSettings}
                  onTurnComplete={dock.notifyChatActivity}
                  chatTargetActive={chatPanelOpen}
                  onOpenSessionInScope={onOpenSessionInScope}
                />
              </Suspense>
            )}</>,
          chatHost,
        )}
        <WorkspaceTerminalPortal
          activeWorkspaceId={dockState.activeTerminalWorkspaceId}
          workspaces={workspaces}
          mountedWorkspaceIds={mountedWorkspaceIds}
          allNodes={allNodes}
          terminalTabsByWorkspace={dockState.terminalTabsByWorkspace}
          activeTerminalTabId={dockState.activeTerminalTabId}
          open={terminalDockOpen}
          onClose={dock.closeTerminal}
          onAgentTypeChange={dock.setTerminalAgentType}
        />
      </FileNodeEditorRegistryProvider>
    </>
  );
};
