import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Canvas } from '../Canvas';
import { FileNodeEditorRegistryProvider } from '../../hooks/useFileNodeEditorRegistry';
import { ChatPanelLazy as ChatPanel } from '../chat/lazy';
import { CHAT_TAB_ID, useRightDock, useRightDockChatHost, useRightDockState } from '../RightDock';
import { ReferenceDrawer } from '../ReferenceDrawer';
import type { SettingsSection } from '../Settings';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import type { WorkbenchController } from './useWorkbenchState';
import type { CanvasClipboard } from '../../types/ui-interaction';
import { useMountedWorkspaceIds } from './useMountedWorkspaceIds';
import { useChatInsertionBridge } from './useChatInsertionBridge';
import { useReferenceManagement } from './useReferenceManagement';
import { WorkspaceTerminalPortal } from './WorkspaceTerminalPortal';

export { useWorkbenchState } from './useWorkbenchState';
export type { WorkbenchController } from './useWorkbenchState';

interface Props {
  activeWorkspaceId: string;
  workspaces: WorkspaceEntry[];
  controller: WorkbenchController;
  onSelectWorkspace: (workspaceId: string) => void;
  /** Opens the global Settings drawer focused on the given section. */
  onOpenAppSettings: (section: SettingsSection) => void;
  /** Opens the settings drawer for a specific workspace. */
  onOpenWorkspaceSettings: (workspaceId: string) => void;
  onSetActiveRootFolder: () => void;
}

export const Workbench: React.FC<Props> = ({
  activeWorkspaceId,
  workspaces,
  controller,
  onSelectWorkspace,
  onOpenAppSettings,
  onOpenWorkspaceSettings,
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
    handleSelectionChange,
    ensureWorkspaceNodesLoaded,
    requestNodeFocus,
    clearFocusRequest,
    clearDeleteRequest,
    clearRenameRequest,
    patchNodeSnapshot,
  } = controller;

  // Chat lives in the right dock as its pinned tab; Workbench keeps owning
  // the per-workspace ChatPanel instances (sessions, mentions, keep-alive)
  // and portals them into the dock's chat pane.
  const dock = useRightDock();
  const dockState = useRightDockState();
  const chatHost = useRightDockChatHost();
  const chatPanelOpen = dockState.expanded && dockState.activeTabId === CHAT_TAB_ID;
  const terminalDockOpen = dockState.expanded
    && dockState.terminalTabs.some((tab) => tab.id === dockState.activeTabId);

  const [canvasClipboard, setCanvasClipboard] = useState<CanvasClipboard | null>(null);
  const mountedWorkspaceIds = useMountedWorkspaceIds(
    activeWorkspaceId,
    workspaces,
    dockState.terminalTabsByWorkspace,
  );
  useEffect(() => {
    for (const node of activeNodes) {
      const ref = node.ref;
      if (ref?.kind === 'workspace-node') ensureWorkspaceNodesLoaded(ref.workspaceId);
    }
  }, [activeNodes, ensureWorkspaceNodesLoaded]);

  const {
    referenceDrawerOpen,
    setReferenceDrawerOpen,
    references,
    activeReference,
    activeReferenceNode,
    removeReference,
    clearAllReferences,
    setActiveReference,
    handleFocusReferenceNode,
    pinReferenceNode,
    pinReferenceUrl,
    resolveReferenceNode,
    handleOpenReferenceSource,
    referencePlacementRequest,
    addReferenceToCanvas,
    consumeReferencePlacementRequest,
    createReferenceNodeFromEntry,
    pasteReferencesIntoCanvas,
    updateReferenceSourceNode,
    nodePatchRequest,
    consumeNodePatchRequest,
  } = useReferenceManagement({
    activeWorkspaceId,
    workspaces,
    allNodes,
    mountedWorkspaceIds,
    ensureWorkspaceNodesLoaded,
    requestNodeFocus,
    onSelectWorkspace,
    patchNodeSnapshot,
  });

  const {
    handleAddDomSelectionToChat,
    handleAddNodeToChat,
    handleSubmitDomReviewComments,
    registerInsertDomSelectionMention,
    registerInsertMention,
    registerSubmitDomReviewComments,
  } = useChatInsertionBridge({ allNodes, openChat: dock.openChat });

  return (
    <>
      <FileNodeEditorRegistryProvider>
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
          onFocusNode={handleFocusReferenceNode}
          onAddReferenceToCanvas={addReferenceToCanvas}
          onWorkspaceNodesRequest={ensureWorkspaceNodesLoaded}
        />
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
                    isActive={isActive}
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
                    resolveReferenceNode={resolveReferenceNode}
                    onOpenReferenceSource={handleOpenReferenceSource}
                    onUpdateReferenceSource={updateReferenceSourceNode}
                    referencePlacementRequest={isActive ? referencePlacementRequest : null}
                    onReferencePlacementComplete={consumeReferencePlacementRequest}
                    createReferenceNode={createReferenceNodeFromEntry}
                    clipboard={canvasClipboard}
                    onClipboardChange={setCanvasClipboard}
                    onPasteReferences={pasteReferencesIntoCanvas}
                    nodePatchRequest={nodePatchRequest?.workspaceId === ws.id ? nodePatchRequest : undefined}
                    onNodePatchComplete={consumeNodePatchRequest}
                    onOpenAppSettings={onOpenAppSettings}
                    onSetRootFolder={onSetActiveRootFolder}
                  />
                </div>
              </div>
            );
          })}
        </div>
        {/* Per-workspace ChatPanels render into the right dock's chat pane.
            The portal escapes the keep-alive router's display:none wrapper,
            so chat stays usable from any route while its state and handlers
            keep living here next to the canvases. */}
        {chatHost && createPortal(
          workspaces.filter((ws) => mountedWorkspaceIds.has(ws.id)).map((ws) => (
            <div
              key={ws.id}
              className="right-dock__chat-instance"
              style={ws.id !== activeWorkspaceId ? { display: 'none' } : undefined}
            >
              <ChatPanel
                workspaceId={ws.id}
                allWorkspaces={workspaces}
                nodes={allNodes[ws.id] || []}
                selectedNodeIds={selectedNodeIdsByWorkspace[ws.id] || []}
                rootFolder={ws.rootFolder}
                onClose={dock.collapse}
                onNodeFocus={(nodeId) => requestNodeFocus(ws.id, nodeId)}
                onOpenAppSettings={onOpenAppSettings}
                onOpenWorkspaceSettings={onOpenWorkspaceSettings}
                onRegisterInsertMention={(fn) => registerInsertMention(ws.id, fn)}
                onRegisterInsertDomSelectionMention={(fn) => registerInsertDomSelectionMention(ws.id, fn)}
                onRegisterSubmitDomReviewComments={(fn) => registerSubmitDomReviewComments(ws.id, fn)}
                onTurnComplete={dock.notifyChatActivity}
              />
            </div>
          )),
          chatHost,
        )}
      <WorkspaceTerminalPortal
        activeWorkspaceId={activeWorkspaceId}
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
