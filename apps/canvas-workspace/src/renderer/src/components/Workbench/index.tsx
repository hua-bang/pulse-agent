import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Canvas } from '../Canvas';
import { FileNodeEditorRegistryProvider } from '../../hooks/useFileNodeEditorRegistry';
import { ChatPanelLazy as ChatPanel } from '../chat/lazy';
import { CHAT_TAB_ID, useRightDock, useRightDockChatHost, useRightDockState } from '../RightDock';
import {
  createReferenceNodeDataSnapshot,
  ReferenceDrawer,
  type NodeReferenceEntryForCanvas,
  type ReferenceEntry,
} from '../ReferenceDrawer';
import type { SettingsSection } from '../Settings';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import type { WorkbenchController } from './useWorkbenchState';
import type { CanvasNode, ReferenceNodeData } from '../../types';
import { createDefaultNode } from '../../utils/nodeFactory';
import { getNodeDisplayLabel } from '../../utils/nodeLabel';
import type { CanvasClipboard, CanvasNodePatchRequest } from '../../types/ui-interaction';
import { isReferenceableNode, isReferenceableNodeType } from '../../utils/referenceNodes';
import { useMountedWorkspaceIds } from './useMountedWorkspaceIds';
import { useChatInsertionBridge } from './useChatInsertionBridge';
import { WorkspaceTerminalPortal } from './WorkspaceTerminalPortal';

export { useWorkbenchState } from './useWorkbenchState';
export type { WorkbenchController } from './useWorkbenchState';

const EMPTY_REFERENCES: ReferenceEntry[] = [];
interface WorkbenchProps {
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

export const Workbench: React.FC<WorkbenchProps> = ({
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
    patchNodeSnapshot,
    handleSelectionChange,
    ensureWorkspaceNodesLoaded,
    requestNodeFocus,
    clearFocusRequest,
    clearDeleteRequest,
    clearRenameRequest,
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

  const [referenceDrawerOpen, setReferenceDrawerOpen] = useState(false);
  const [referencesByWorkspace, setReferencesByWorkspace] = useState<Record<string, ReferenceEntry[]>>({});
  const [activeReferenceIdByWorkspace, setActiveReferenceIdByWorkspace] = useState<Record<string, string | undefined>>({});
  const [canvasClipboard, setCanvasClipboard] = useState<CanvasClipboard | null>(null);
  const [nodePatchRequest, setNodePatchRequest] = useState<CanvasNodePatchRequest | undefined>();
  const patchRequestIdRef = useRef(0);
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

  const references = referencesByWorkspace[activeWorkspaceId] ?? EMPTY_REFERENCES;
  const activeReferenceId = activeReferenceIdByWorkspace[activeWorkspaceId];
  const activeReference = activeReferenceId
    ? references.find((entry) => (entry.kind === 'url' ? entry.id : `${entry.workspaceId}:${entry.nodeId}`) === activeReferenceId)
    : undefined;
  const activeReferenceNode = activeReference && activeReference.kind === 'node'
    ? (allNodes[activeReference.workspaceId] ?? []).find((node) => node.id === activeReference.nodeId)
    : undefined;

  const removeReference = useCallback((referenceId: string) => {
    setReferencesByWorkspace((prev) => {
      const current = prev[activeWorkspaceId] ?? [];
      const next = current.filter((entry) => (entry.kind === 'url' ? entry.id : `${entry.workspaceId}:${entry.nodeId}`) !== referenceId);
      if (next.length === current.length) return prev;
      return { ...prev, [activeWorkspaceId]: next };
    });
    setActiveReferenceIdByWorkspace((prev) => {
      if (prev[activeWorkspaceId] !== referenceId) return prev;
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

  const setActiveReference = useCallback((nodeId: string | undefined) => {
    setActiveReferenceIdByWorkspace((prev) => ({
      ...prev,
      [activeWorkspaceId]: nodeId,
    }));
  }, [activeWorkspaceId]);

  const handleFocusReferenceNode = useCallback((workspaceId: string, nodeId: string) => {
    if (workspaceId !== activeWorkspaceId) onSelectWorkspace(workspaceId);
    requestNodeFocus(workspaceId, nodeId);
  }, [activeWorkspaceId, onSelectWorkspace, requestNodeFocus]);

  useEffect(() => {
    const current = referencesByWorkspace[activeWorkspaceId];
    if (!current?.length) return;
    const knownByWorkspace = new Map<string, Set<string>>();
    for (const [workspaceId, snapshot] of Object.entries(allNodes)) {
      knownByWorkspace.set(workspaceId, new Set(snapshot.map((node) => node.id)));
    }
    const filtered = current.filter((entry) => (
      entry.kind === 'url'
      || knownByWorkspace.get(entry.workspaceId)?.has(entry.nodeId)
      || !Object.prototype.hasOwnProperty.call(allNodes, entry.workspaceId)
    ));
    if (filtered.length === current.length) return;
    setReferencesByWorkspace((prev) => ({ ...prev, [activeWorkspaceId]: filtered }));
    setActiveReferenceIdByWorkspace((prev) => {
      const currentActive = prev[activeWorkspaceId];
      if (currentActive && filtered.some((entry) => (entry.kind === 'url' ? entry.id : `${entry.workspaceId}:${entry.nodeId}`) === currentActive)) return prev;
      const nextActive = filtered[0] ? (filtered[0].kind === 'url' ? filtered[0].id : `${filtered[0].workspaceId}:${filtered[0].nodeId}`) : undefined;
      return { ...prev, [activeWorkspaceId]: nextActive };
    });
  }, [activeWorkspaceId, allNodes, referencesByWorkspace]);

  const pinReferenceNode = useCallback((workspaceId: string, nodeId: string) => {
    setReferencesByWorkspace((prev) => {
      const current = prev[activeWorkspaceId] ?? [];
      const exists = current.some((entry) => entry.kind === 'node' && entry.workspaceId === workspaceId && entry.nodeId === nodeId);
      if (exists) return prev;
      const workspace = workspaces.find((item) => item.id === workspaceId);
      const node = (allNodes[workspaceId] ?? []).find((item) => item.id === nodeId);
      const entry: ReferenceEntry = {
        kind: 'node',
        workspaceId,
        nodeId,
        titleSnapshot: node ? getNodeDisplayLabel(node) : undefined,
        typeSnapshot: node?.type,
        workspaceNameSnapshot: workspace?.name,
      };
      return { ...prev, [activeWorkspaceId]: [...current, entry] };
    });
    setActiveReferenceIdByWorkspace((prev) => ({
      ...prev,
      [activeWorkspaceId]: `${workspaceId}:${nodeId}`,
    }));
    setReferenceDrawerOpen(true);
  }, [activeWorkspaceId, allNodes, workspaces]);

  const pinReferenceUrl = useCallback((url: string, title?: string) => {
    const id = `url:${url}`;
    setReferencesByWorkspace((prev) => {
      const current = prev[activeWorkspaceId] ?? [];
      const exists = current.some((entry) => 'kind' in entry && entry.kind === 'url' && entry.url === url);
      if (exists) return prev;
      const entry: ReferenceEntry = { kind: 'url', id, url, title };
      return { ...prev, [activeWorkspaceId]: [...current, entry] };
    });
    setActiveReferenceIdByWorkspace((prev) => ({
      ...prev,
      [activeWorkspaceId]: id,
    }));
    setReferenceDrawerOpen(true);
  }, [activeWorkspaceId]);

  const {
    handleAddDomSelectionToChat,
    handleAddNodeToChat,
    registerInsertDomSelectionMention,
    registerInsertMention,
  } = useChatInsertionBridge({ allNodes, openChat: dock.openChat });

  const workspaceNameById = useCallback(
    (workspaceId: string) => workspaces.find((workspace) => workspace.id === workspaceId)?.name,
    [workspaces],
  );

  const resolveReferenceNode = useCallback((node: CanvasNode) => {
    const ref = node.ref;
    if (!ref || ref.kind !== 'workspace-node') return {};
    return {
      node: (allNodes[ref.workspaceId] ?? []).find((item) => item.id === ref.nodeId),
      workspaceName: workspaceNameById(ref.workspaceId),
    };
  }, [allNodes, workspaceNameById]);

  const resolveReferenceSource = useCallback((node: CanvasNode, fallbackWorkspaceId: string) => {
    if (node.type === 'reference' && node.ref?.kind === 'workspace-node') {
      const sourceNode = (allNodes[node.ref.workspaceId] ?? []).find((item) => item.id === node.ref?.nodeId);
      return sourceNode
        ? { workspaceId: node.ref.workspaceId, node: sourceNode }
        : undefined;
    }
    return { workspaceId: fallbackWorkspaceId, node };
  }, [allNodes]);

  const handleOpenReferenceSource = useCallback((node: CanvasNode) => {
    const ref = node.ref;
    if (!ref || ref.kind !== 'workspace-node') return;
    if (ref.workspaceId !== activeWorkspaceId) onSelectWorkspace(ref.workspaceId);
    requestNodeFocus(ref.workspaceId, ref.nodeId);
  }, [activeWorkspaceId, onSelectWorkspace, requestNodeFocus]);

  const [referencePlacementRequest, setReferencePlacementRequest] = useState<NodeReferenceEntryForCanvas | null>(null);

  const addReferenceToCanvas = useCallback((entry: NodeReferenceEntryForCanvas) => {
    ensureWorkspaceNodesLoaded(entry.workspaceId);
    setReferencePlacementRequest(entry);
    setReferenceDrawerOpen(false);
  }, [ensureWorkspaceNodesLoaded]);

  const consumeReferencePlacementRequest = useCallback(() => {
    setReferencePlacementRequest(null);
  }, []);

  const createReferenceNodeFromEntry = useCallback((entry: NodeReferenceEntryForCanvas, x: number, y: number): CanvasNode | null => {
    const sourceNode = (allNodes[entry.workspaceId] ?? []).find((node) => node.id === entry.nodeId);
    const workspaceName = workspaceNameById(entry.workspaceId) ?? entry.workspaceNameSnapshot;
    const snapshot = sourceNode
      ? createReferenceNodeDataSnapshot(sourceNode, workspaceName)
      : {
          titleSnapshot: entry.titleSnapshot,
          typeSnapshot: entry.typeSnapshot === 'reference' ? undefined : entry.typeSnapshot,
          workspaceNameSnapshot: workspaceName,
        };
    const node = {
      ...createDefaultNode('reference', x, y),
      ...(sourceNode ? { width: sourceNode.width, height: sourceNode.height } : {}),
      title: snapshot.titleSnapshot ? `Ref: ${snapshot.titleSnapshot}` : 'Reference',
      ref: {
        kind: 'workspace-node' as const,
        workspaceId: entry.workspaceId,
        nodeId: entry.nodeId,
      },
      data: snapshot,
      updatedAt: Date.now(),
    };
    return node;
  }, [allNodes, workspaceNameById]);

  const createReferenceNodeFromSource = useCallback((sourceNode: CanvasNode, sourceWorkspaceId: string, x: number, y: number): CanvasNode | null => {
    if (!isReferenceableNode(sourceNode)) return null;
    const workspaceName = workspaceNameById(sourceWorkspaceId);
    const snapshot = createReferenceNodeDataSnapshot(sourceNode, workspaceName);
    return {
      ...createDefaultNode('reference', x, y),
      width: sourceNode.width,
      height: sourceNode.height,
      title: snapshot.titleSnapshot ? `Ref: ${snapshot.titleSnapshot}` : 'Reference',
      ref: {
        kind: 'workspace-node' as const,
        workspaceId: sourceWorkspaceId,
        nodeId: sourceNode.id,
      },
      data: snapshot,
      updatedAt: Date.now(),
    };
  }, [workspaceNameById]);

  const pasteReferencesIntoCanvas = useCallback((targetWorkspaceId: string, clipboard: CanvasClipboard): CanvasNode[] => {
    if (clipboard.sourceWorkspaceId === targetWorkspaceId || clipboard.nodes.length === 0) return [];

    const created: CanvasNode[] = [];
    let skipped = 0;
    for (const source of clipboard.nodes) {
      const pasteX = source.x + 24;
      const pasteY = source.y + 24;
      const resolved = resolveReferenceSource(source, clipboard.sourceWorkspaceId);

      if (source.type === 'reference' && source.ref?.kind === 'workspace-node' && !resolved) {
        const sourceSnapshot = source.data as ReferenceNodeData;
        if (sourceSnapshot.typeSnapshot && !isReferenceableNodeType(sourceSnapshot.typeSnapshot)) {
          skipped += 1;
          continue;
        }
        const snapshot: ReferenceNodeData = {
          titleSnapshot: sourceSnapshot.titleSnapshot,
          typeSnapshot: sourceSnapshot.typeSnapshot,
          workspaceNameSnapshot: sourceSnapshot.workspaceNameSnapshot ?? workspaceNameById(source.ref.workspaceId),
        };
        created.push({
          ...createDefaultNode('reference', pasteX, pasteY),
          width: source.width,
          height: source.height,
          title: snapshot.titleSnapshot ? `Ref: ${snapshot.titleSnapshot}` : source.title,
          ref: {
            kind: 'workspace-node',
            workspaceId: source.ref.workspaceId,
            nodeId: source.ref.nodeId,
          },
          data: snapshot,
          updatedAt: Date.now(),
        });
        continue;
      }

      const sourceWorkspaceId = resolved?.workspaceId ?? clipboard.sourceWorkspaceId;
      const sourceNode = resolved?.node ?? source;
      const refNode = createReferenceNodeFromSource(
        sourceNode,
        sourceWorkspaceId,
        pasteX,
        pasteY,
      );
      if (!refNode) {
        skipped += 1;
        continue;
      }
      created.push(refNode);
    }

    if (skipped > 0) {
      // Keep this quiet for now; unsupported nodes are simply ignored so
      // mixed selections can still paste the useful references.
      console.debug(`[canvas] skipped ${skipped} unsupported cross-workspace reference paste node(s)`);
    }

    return created;
  }, [createReferenceNodeFromSource, resolveReferenceSource, workspaceNameById]);

  const savePatchedWorkspaceSnapshot = useCallback((workspaceId: string, nodes: CanvasNode[]) => {
    const api = window.canvasWorkspace?.store;
    if (!api) return;
    void api.load(workspaceId).then((result) => {
      const current = result.ok && result.data
        ? result.data
        : { nodes: [], edges: [], transform: { x: 0, y: 0, scale: 1 }, savedAt: new Date().toISOString() };
      void api.save(workspaceId, {
        ...current,
        nodes,
        savedAt: new Date().toISOString(),
      });
    });
  }, []);

  const patchWorkspaceNodeSnapshot = useCallback((workspaceId: string, nodeId: string, patch: Partial<CanvasNode>) => {
    const patched = patchNodeSnapshot(workspaceId, nodeId, patch);
    if (patched) savePatchedWorkspaceSnapshot(workspaceId, patched);
  }, [patchNodeSnapshot, savePatchedWorkspaceSnapshot]);

  const updateReferenceSourceNode = useCallback((referenceNode: CanvasNode, patch: Partial<CanvasNode>) => {
    const ref = referenceNode.ref;
    if (!ref || ref.kind !== 'workspace-node') return;
    const source = (allNodes[ref.workspaceId] ?? []).find((item) => item.id === ref.nodeId);
    const sourceType = source?.type ?? (referenceNode.data as { typeSnapshot?: CanvasNode['type'] }).typeSnapshot;
    if (sourceType && !isReferenceableNodeType(sourceType)) return;

    if (mountedWorkspaceIds.has(ref.workspaceId)) {
      const requestId = ++patchRequestIdRef.current;
      setNodePatchRequest({ workspaceId: ref.workspaceId, nodeId: ref.nodeId, patch, requestId });
      return;
    }

    patchWorkspaceNodeSnapshot(ref.workspaceId, ref.nodeId, patch);
  }, [allNodes, mountedWorkspaceIds, patchWorkspaceNodeSnapshot]);

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
                    onNodePatchComplete={(requestId) => {
                      if (nodePatchRequest?.requestId === requestId) setNodePatchRequest(undefined);
                    }}
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
        onAgentTypeDetected={dock.setTerminalAgentType}
      />
      </FileNodeEditorRegistryProvider>
    </>
  );
};
