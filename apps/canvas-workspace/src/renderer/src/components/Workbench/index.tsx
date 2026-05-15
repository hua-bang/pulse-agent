import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Canvas } from '../Canvas';
import { FileNodeEditorRegistryProvider } from '../../hooks/useFileNodeEditorRegistry';
import { ChatPanel } from '../chat';
import { ReferenceDrawer, type ReferenceEntry } from '../ReferenceDrawer';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import type { WorkbenchController } from './useWorkbenchState';

export { useWorkbenchState } from './useWorkbenchState';
export type { WorkbenchController } from './useWorkbenchState';

const DEFAULT_CHAT_WIDTH = 420;
const MIN_CHAT_WIDTH = 280;
const MAX_CHAT_WIDTH = 600;

const EMPTY_REFERENCES: ReferenceEntry[] = [];

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
  const [referencesByWorkspace, setReferencesByWorkspace] = useState<Record<string, ReferenceEntry[]>>({});
  const [activeReferenceIdByWorkspace, setActiveReferenceIdByWorkspace] = useState<Record<string, string | undefined>>({});
  const [chatWidth, setChatWidth] = useState(DEFAULT_CHAT_WIDTH);

  const references = referencesByWorkspace[activeWorkspaceId] ?? EMPTY_REFERENCES;
  const activeReferenceId = activeReferenceIdByWorkspace[activeWorkspaceId];
  const activeReference = activeReferenceId
    ? references.find((entry) => entry.nodeId === activeReferenceId)
    : undefined;
  const activeReferenceNode = activeReference
    ? activeNodes.find((node) => node.id === activeReference.nodeId)
    : undefined;

  const removeReference = useCallback((nodeId: string) => {
    setReferencesByWorkspace((prev) => {
      const current = prev[activeWorkspaceId] ?? [];
      const next = current.filter((entry) => entry.nodeId !== nodeId);
      if (next.length === current.length) return prev;
      return { ...prev, [activeWorkspaceId]: next };
    });
    setActiveReferenceIdByWorkspace((prev) => {
      if (prev[activeWorkspaceId] !== nodeId) return prev;
      return { ...prev, [activeWorkspaceId]: undefined };
    });
  }, [activeWorkspaceId]);

  const clearAllReferences = useCallback(() => {
    setReferencesByWorkspace((prev) => {
      if (!prev[activeWorkspaceId]?.length) return prev;
      return { ...prev, [activeWorkspaceId]: [] };
    });
    setActiveReferenceIdByWorkspace((prev) => ({
      ...prev,
      [activeWorkspaceId]: undefined,
    }));
  }, [activeWorkspaceId]);

  const setReferenceGroup = useCallback((nodeId: string, group: string | undefined) => {
    const normalized = group?.trim() ? group.trim() : undefined;
    setReferencesByWorkspace((prev) => {
      const current = prev[activeWorkspaceId] ?? [];
      let changed = false;
      const next = current.map((entry) => {
        if (entry.nodeId !== nodeId) return entry;
        if ((entry.group ?? undefined) === normalized) return entry;
        changed = true;
        return { ...entry, group: normalized };
      });
      if (!changed) return prev;
      return { ...prev, [activeWorkspaceId]: next };
    });
  }, [activeWorkspaceId]);

  const setActiveReference = useCallback((nodeId: string | undefined) => {
    setActiveReferenceIdByWorkspace((prev) => ({
      ...prev,
      [activeWorkspaceId]: nodeId,
    }));
  }, [activeWorkspaceId]);

  const handleFocusReferenceNode = useCallback((nodeId: string) => {
    requestNodeFocus(activeWorkspaceId, nodeId);
  }, [activeWorkspaceId, requestNodeFocus]);

  useEffect(() => {
    const current = referencesByWorkspace[activeWorkspaceId];
    if (!current?.length) return;
    const known = new Set(activeNodes.map((node) => node.id));
    const filtered = current.filter((entry) => known.has(entry.nodeId));
    if (filtered.length === current.length) return;
    setReferencesByWorkspace((prev) => ({ ...prev, [activeWorkspaceId]: filtered }));
    setActiveReferenceIdByWorkspace((prev) => {
      const currentActive = prev[activeWorkspaceId];
      if (currentActive && filtered.some((entry) => entry.nodeId === currentActive)) return prev;
      return { ...prev, [activeWorkspaceId]: filtered[0]?.nodeId };
    });
  }, [activeWorkspaceId, activeNodes, referencesByWorkspace]);

  const pinReferenceNode = useCallback((nodeId: string, group?: string) => {
    setReferencesByWorkspace((prev) => {
      const current = prev[activeWorkspaceId] ?? [];
      const exists = current.some((entry) => entry.nodeId === nodeId);
      if (exists) return prev;
      const entry: ReferenceEntry = group ? { nodeId, group } : { nodeId };
      return { ...prev, [activeWorkspaceId]: [...current, entry] };
    });
    setActiveReferenceIdByWorkspace((prev) => ({
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
      <FileNodeEditorRegistryProvider>
      <ReferenceDrawer
        open={referenceDrawerOpen}
        references={references}
        activeReferenceNode={activeReferenceNode}
        activeReferenceGroup={activeReference?.group}
        nodes={activeNodes}
        selectedNode={activeSelectedNode}
        onOpenChange={setReferenceDrawerOpen}
        onSelectReference={setActiveReference}
        onRemoveReference={removeReference}
        onClearAll={clearAllReferences}
        onAddReference={pinReferenceNode}
        onSetReferenceGroup={setReferenceGroup}
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
      </FileNodeEditorRegistryProvider>
    </>
  );
};
