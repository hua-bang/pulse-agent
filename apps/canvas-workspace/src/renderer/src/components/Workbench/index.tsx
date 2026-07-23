import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './index.css';
import { Canvas } from '../Canvas';
import { FileNodeEditorRegistryProvider } from '../../hooks/useFileNodeEditorRegistry';
import { ChatPanelLazy as ChatPanel } from '../chat/lazy';
import { isDockChatVisible, isDockTerminalVisible, useRightDock, useRightDockChatHost, useRightDockState } from '../RightDock';
import { buildDockTabRefs } from '../RightDock/tabRefs';
import { createReferenceNodeDataSnapshot } from '../ReferenceDrawer/utils';
import type { NodeReferenceEntry as NodeReferenceEntryForCanvas } from '../ReferenceDrawer/types';
import type { SettingsSection } from '../Settings';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import type { WorkbenchController } from './useWorkbenchState';
import type { CanvasNode, ReferenceNodeData } from '../../types';
import { createDefaultNode } from '../../utils/nodeFactory';
import type { CanvasClipboard, CanvasNodePatchRequest } from '../../types/ui-interaction';
import { isReferenceableNode, isReferenceableNodeType } from '../../utils/referenceNodes';
import { useMountedWorkspaceIds } from './useMountedWorkspaceIds';
import { useChatInsertionBridge } from './useChatInsertionBridge';
import { useEvictAndPreview, usePeekNode, usePreviewNodeActionBridge } from './usePreviewNodeActionBridge';
import { useReferenceEntries } from './useReferenceEntries';
import { WorkspaceTerminalPortal } from './WorkspaceTerminalPortal';
import { useLoadedChatWorkspaceIds } from './useLoadedChatWorkspaceIds';
import type { KnowledgeChatRouteContext } from './knowledgeChatContext';
export { useWorkbenchState } from './useWorkbenchState';
export type { WorkbenchController } from './useWorkbenchState';
const ReferenceDrawer = lazy(() => import('../ReferenceDrawer').then((m) => ({ default: m.ReferenceDrawer })));
const KnowledgeChatPortal = lazy(() => import('./KnowledgeChatPortal').then((m) => ({ default: m.KnowledgeChatPortal })));
interface WorkbenchProps {
  activeWorkspaceId: string;
  workspaces: WorkspaceEntry[];
  controller: WorkbenchController;
  knowledgeChatContext: KnowledgeChatRouteContext;
  onRemoveKnowledgeChatContext?: (key: string) => void; onKnowledgeComposerRequestHandled?: (requestId: string) => void;
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
  knowledgeChatContext,
  onRemoveKnowledgeChatContext, onKnowledgeComposerRequestHandled,
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
  const dock = useRightDock();
  const dockState = useRightDockState();
  const chatHost = useRightDockChatHost();
  const chatPanelOpen = isDockChatVisible(dockState);
  const loadedChatWorkspaceIds = useLoadedChatWorkspaceIds(chatPanelOpen, activeWorkspaceId);
  const terminalDockOpen = isDockTerminalVisible(dockState);
  const [canvasClipboard, setCanvasClipboard] = useState<CanvasClipboard | null>(null);
  const [nodePatchRequest, setNodePatchRequest] = useState<CanvasNodePatchRequest | undefined>();
  const patchRequestIdRef = useRef(0);
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
    handleAddNodeToChat,
    handleAddPreviewNodeToChat,
    handleSubmitDomReviewComments,
    registerInsertDomSelectionMention,
    registerInsertMention,
    registerSubmitDomReviewComments,
  } = useChatInsertionBridge({ allNodes, openChat: dock.openChat });

  useEffect(() => dock.registerPinUrlReference(pinReferenceUrl), [dock, pinReferenceUrl]);

  useEffect(() => dock.registerAddDomSelectionToChat(handleAddDomSelectionToChat), [dock, handleAddDomSelectionToChat]);

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
    peekNode(ref.workspaceId, ref.nodeId);
  }, [peekNode]);

  const [referencePlacementRequest, setReferencePlacementRequest] = useState<NodeReferenceEntryForCanvas | null>(null);

  const addReferenceToCanvas = useCallback((entry: NodeReferenceEntryForCanvas) => {
    ensureWorkspaceNodesLoaded(entry.workspaceId);
    setReferencePlacementRequest(entry);
    setReferenceDrawerOpen(false);
  }, [ensureWorkspaceNodesLoaded]);

  const consumeReferencePlacementRequest = useCallback(() => {
    setReferencePlacementRequest(null);
  }, []);

  usePreviewNodeActionBridge({ activeWorkspaceId, workspaces, addPreviewNodeToChat: handleAddPreviewNodeToChat, pinReferenceNode, addReferenceToCanvas, ensureWorkspaceNodesLoaded });

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
              onAddReferenceToCanvas={addReferenceToCanvas}
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
        {chatHost && createPortal(
          <>
            {workspaces.filter((ws) => mountedWorkspaceIds.has(ws.id) && loadedChatWorkspaceIds.has(ws.id)).map((ws) => (
              <div
                key={ws.id}
                className="right-dock__chat-instance"
                style={knowledgeChatContext.active || ws.id !== activeWorkspaceId ? { display: 'none' } : undefined}
              >
                <ChatPanel
                  workspaceId={ws.id}
                  allWorkspaces={workspaces}
                  nodes={allNodes[ws.id] || []}
                  dockTabs={buildDockTabRefs(dockState, ws.id)}
                  selectedNodeIds={selectedNodeIdsByWorkspace[ws.id] || []}
                  rootFolder={ws.rootFolder} onClose={dock.collapse}
                  onNodeFocus={(nodeId) => requestNodeFocus(ws.id, nodeId)}
                  onOpenAppSettings={onOpenAppSettings} onOpenWorkspaceSettings={onOpenWorkspaceSettings}
                  onRegisterInsertMention={(fn) => registerInsertMention(ws.id, fn)}
                  onRegisterInsertDomSelectionMention={(fn) => registerInsertDomSelectionMention(ws.id, fn)}
                  onRegisterSubmitDomReviewComments={(fn) => registerSubmitDomReviewComments(ws.id, fn)}
                  onTurnComplete={dock.notifyChatActivity}
                />
              </div>
            ))}
            {knowledgeChatContext.active && (
              <Suspense fallback={null}>
                <KnowledgeChatPortal selectedNode={knowledgeChatContext.selectedNode} workspaces={workspaces} contextNodes={knowledgeChatContext.explicitContext?.nodes} contextTags={knowledgeChatContext.explicitContext?.tags} contextCanvases={knowledgeChatContext.explicitContext?.canvases} composerRequest={knowledgeChatContext.explicitContext?.composerRequest} onComposerRequestHandled={onKnowledgeComposerRequestHandled} onRemoveContext={onRemoveKnowledgeChatContext} onClose={dock.collapse} onOpenAppSettings={onOpenAppSettings} onTurnComplete={dock.notifyChatActivity} />
              </Suspense>
            )}</>,
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
