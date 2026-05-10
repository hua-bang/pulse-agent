import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Canvas } from '../Canvas';
import { ChatPanel } from '../chat';
import { ReferenceDrawer } from '../ReferenceDrawer';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import type { WorkbenchController } from './useWorkbenchState';

export { useWorkbenchState } from './useWorkbenchState';
export type { WorkbenchController } from './useWorkbenchState';

const DEFAULT_CHAT_WIDTH = 420;
const MIN_CHAT_WIDTH = 280;
const MAX_CHAT_WIDTH = 600;

interface WorkbenchProps {
  activeWorkspaceId: string;
  workspaces: WorkspaceEntry[];
  controller: WorkbenchController;
}

export const Workbench: React.FC<WorkbenchProps> = ({
  activeWorkspaceId,
  workspaces,
  controller,
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
    requestNodeFocus,
    clearFocusRequest,
    clearDeleteRequest,
    clearRenameRequest,
  } = controller;

  const [chatPanelOpen, setChatPanelOpen] = useState(false);
  const [referenceDrawerOpen, setReferenceDrawerOpen] = useState(false);
  const [referenceNodeIdByWorkspace, setReferenceNodeIdByWorkspace] = useState<Record<string, string | undefined>>({});
  const [chatWidth, setChatWidth] = useState(DEFAULT_CHAT_WIDTH);

  const referenceNodeId = referenceNodeIdByWorkspace[activeWorkspaceId];
  const referenceNode = referenceNodeId
    ? activeNodes.find((node) => node.id === referenceNodeId)
    : undefined;

  const clearReferenceNode = useCallback(() => {
    setReferenceNodeIdByWorkspace((prev) => ({
      ...prev,
      [activeWorkspaceId]: undefined,
    }));
  }, [activeWorkspaceId]);

  const handleFocusReferenceNode = useCallback((nodeId: string) => {
    requestNodeFocus(activeWorkspaceId, nodeId);
  }, [activeWorkspaceId, requestNodeFocus]);

  useEffect(() => {
    if (!referenceNodeId) return;
    if (activeNodes.some((node) => node.id === referenceNodeId)) return;
    setReferenceNodeIdByWorkspace((prev) => ({
      ...prev,
      [activeWorkspaceId]: undefined,
    }));
  }, [activeWorkspaceId, activeNodes, referenceNodeId]);

  const pinReferenceNode = useCallback((nodeId: string) => {
    setReferenceNodeIdByWorkspace((prev) => ({
      ...prev,
      [activeWorkspaceId]: nodeId,
    }));
    setReferenceDrawerOpen(true);
  }, [activeWorkspaceId]);

  const resizing = useRef(false);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = true;
    const startX = e.clientX;
    const startWidth = chatWidth;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      const newWidth = Math.min(MAX_CHAT_WIDTH, Math.max(MIN_CHAT_WIDTH, startWidth + delta));
      setChatWidth(newWidth);
    };

    const onMouseUp = () => {
      resizing.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [chatWidth]);

  return (
    <>
      <ReferenceDrawer
        open={referenceDrawerOpen}
        referenceNode={referenceNode}
        selectedNode={activeSelectedNode}
        onOpenChange={setReferenceDrawerOpen}
        onClear={clearReferenceNode}
        onFocusNode={handleFocusReferenceNode}
      />
      <div className="canvas-viewport">
        {workspaces
          .filter((ws) => ws.id === activeWorkspaceId)
          .map((ws) => (
            <Canvas
              key={ws.id}
              canvasId={ws.id}
              canvasName={ws.name}
              rootFolder={ws.rootFolder}
              onNodesChange={handleNodesChange}
              onSelectionChange={handleSelectionChange}
              focusNodeId={ws.id === focusRequest?.workspaceId ? focusRequest.nodeId : undefined}
              onFocusComplete={clearFocusRequest}
              deleteNodeId={ws.id === deleteRequest?.workspaceId ? deleteRequest.nodeId : undefined}
              onDeleteComplete={clearDeleteRequest}
              renameRequest={ws.id === renameRequest?.workspaceId ? renameRequest : undefined}
              onRenameComplete={clearRenameRequest}
              chatPanelOpen={chatPanelOpen}
              onChatToggle={() => setChatPanelOpen((prev) => !prev)}
              referenceDrawerOpen={referenceDrawerOpen}
              onReferenceToggle={() => setReferenceDrawerOpen((prev) => !prev)}
              onPinReferenceNode={pinReferenceNode}
            />
          ))}
      </div>
      {workspaces.map((ws) => (
        <div
          key={ws.id}
          className={`chat-panel-wrapper${chatPanelOpen && ws.id === activeWorkspaceId ? ' chat-panel-wrapper--open' : ''}`}
          style={ws.id !== activeWorkspaceId ? { display: 'none' } : chatPanelOpen ? { width: chatWidth } : undefined}
        >
          <ChatPanel
            workspaceId={ws.id}
            allWorkspaces={workspaces}
            nodes={allNodes[ws.id] || []}
            selectedNodeIds={selectedNodeIdsByWorkspace[ws.id] || []}
            rootFolder={ws.rootFolder}
            onClose={() => setChatPanelOpen(false)}
            onResizeStart={handleResizeStart}
            onNodeFocus={(nodeId) => requestNodeFocus(ws.id, nodeId)}
          />
        </div>
      ))}
    </>
  );
};
