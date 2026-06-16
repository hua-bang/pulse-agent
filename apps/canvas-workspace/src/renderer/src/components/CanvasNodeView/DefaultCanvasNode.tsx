import {
  useCallback,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import type { AgentContextDomSelectionRef, CanvasNode } from '../../types';
import { AgentNodeBody } from '../AgentNodeBody';
import { DynamicAppNodeBody } from '../DynamicAppNodeBody';
import { FileNodeBody } from '../FileNodeBody';
import { FrameNodeBody } from '../FrameNodeBody';
import { IframeNodeBody } from '../IframeNodeBody';
import { PluginNodeBody } from '../PluginNodeBody';
import { TerminalNodeBody } from '../TerminalNodeBody';
import { TextNodeBody } from '../TextNodeBody';
import { CanvasNodeHeader } from './CanvasNodeHeader';
import { NodeResizeHandles } from './NodeResizeHandles';
import type { ResizeHandlerFactory } from './types';

interface DefaultCanvasNodeProps {
  classes: string;
  fullscreenButton: ReactNode;
  getAllNodes?: () => CanvasNode[];
  containerDescendantCount: number;
  handleClose: (e: MouseEvent) => void;
  handleFocus: (e: MouseEvent) => void;
  handleHeaderMouseDown: (e: MouseEvent) => void;
  handleNodeBodyMouseDown: (e: MouseEvent) => void;
  handleNodeClick: (e: MouseEvent) => void;
  handleReference: (e: MouseEvent) => void;
  handleAddToChat: (e: MouseEvent) => void;
  handleTitleBlur: (e: FocusEvent<HTMLSpanElement>) => void;
  handleTitleDoubleClick: (e: MouseEvent) => void;
  handleTitleKeyDown: (e: KeyboardEvent<HTMLSpanElement>) => void;
  handleUngroup: (e: MouseEvent) => void;
  isEditingTitle: boolean;
  isFullscreen: boolean;
  isResizing: boolean;
  isSelected: boolean;
  makeResizeHandler: ResizeHandlerFactory;
  node: CanvasNode;
  onDragStart: (e: MouseEvent, node: CanvasNode) => void;
  onReference?: (nodeId: string) => void;
  onAddToChat?: (nodeId: string) => void;
  onAddDomSelectionToChat?: (selection: AgentContextDomSelectionRef) => void;
  onSelect: (id: string, mods?: { shift?: boolean; meta?: boolean }) => void;
  onRemoveNodes?: (ids: string[]) => void;
  onUngroupSelectedGroups?: () => void;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  readOnly: boolean;
  relativeTime: string | null;
  rootFolder?: string;
  titleRef: RefObject<HTMLSpanElement>;
  workspaceId?: string;
  workspaceName?: string;
  wrapperStyle: CSSProperties;
}

interface PluginEmbeddedElement extends HTMLElement {
  executeJavaScript?: <T = unknown>(script: string, userGesture?: boolean) => Promise<T>;
  reload?: () => void;
  openDevTools?: () => void;
}

interface PluginReloadSnapshot {
  data?: unknown;
  payload?: unknown;
  title?: unknown;
}

function findPluginEmbeddedElement(event: MouseEvent): PluginEmbeddedElement | null {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return null;
  return target.closest('.canvas-node')?.querySelector('webview, iframe') as PluginEmbeddedElement | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function readPluginReloadSnapshot(
  embedded: PluginEmbeddedElement | null,
): Promise<PluginReloadSnapshot | null> {
  if (!embedded || typeof embedded.executeJavaScript !== 'function') return null;
  try {
    const snapshot = await embedded.executeJavaScript<unknown>(
      `(() => {
        const bridge = window.__pulseCanvasPluginNode;
        if (!bridge) return null;
        if (typeof bridge.beforeReload === 'function') return bridge.beforeReload();
        if (typeof bridge.snapshot === 'function') return bridge.snapshot();
        return null;
      })()`,
      false,
    );
    return isRecord(snapshot) ? snapshot : null;
  } catch (err) {
    console.warn('[plugin-node] failed to snapshot plugin before reload', err);
    return null;
  }
}

function patchFromPluginSnapshot(
  node: CanvasNode,
  snapshot: PluginReloadSnapshot | null,
): Partial<CanvasNode> | null {
  if (!snapshot) return null;
  const patch: Partial<CanvasNode> = {};
  if (typeof snapshot.title === 'string' && snapshot.title.trim()) {
    patch.title = snapshot.title.trim();
  }

  const baseData = isRecord(node.data) ? node.data : {};
  const nextData = isRecord(snapshot.data) ? { ...baseData, ...snapshot.data } : { ...baseData };
  let hasDataPatch = isRecord(snapshot.data);
  if (snapshot.payload !== undefined) {
    nextData.payload = snapshot.payload;
    hasDataPatch = true;
  }
  if (hasDataPatch) patch.data = nextData;

  return Object.keys(patch).length > 0 ? patch : null;
}

export const DefaultCanvasNode = ({
  classes,
  fullscreenButton,
  getAllNodes,
  containerDescendantCount,
  handleClose,
  handleFocus,
  handleHeaderMouseDown,
  handleNodeBodyMouseDown,
  handleNodeClick,
  handleReference,
  handleAddToChat,
  handleTitleBlur,
  handleTitleDoubleClick,
  handleTitleKeyDown,
  handleUngroup,
  isEditingTitle,
  isFullscreen,
  isResizing,
  isSelected,
  makeResizeHandler,
  node,
  onDragStart,
  onReference,
  onAddToChat,
  onAddDomSelectionToChat,
  onSelect,
  onRemoveNodes,
  onUngroupSelectedGroups,
  onUpdate,
  readOnly,
  relativeTime,
  rootFolder,
  titleRef,
  workspaceId,
  workspaceName,
  wrapperStyle,
}: DefaultCanvasNodeProps) => {
  const [pluginReloadToken, setPluginReloadToken] = useState(0);
  const handlePluginReload = useCallback((event: MouseEvent) => {
    event.stopPropagation();
    const embedded = findPluginEmbeddedElement(event);
    void (async () => {
      const snapshot = await readPluginReloadSnapshot(embedded);
      const patch = patchFromPluginSnapshot(node, snapshot);
      if (patch) onUpdate(node.id, patch);

      if (embedded && !patch) {
        console.warn('[plugin-node] reload without snapshot; plugin state may reset');
      }
      window.setTimeout(() => {
        setPluginReloadToken((value) => value + 1);
      }, 0);
    })();
  }, [node, onUpdate]);

  const handlePluginDevTools = useCallback((event: MouseEvent) => {
    event.stopPropagation();
    const embedded = findPluginEmbeddedElement(event);
    if (embedded && typeof embedded.openDevTools === 'function') {
      try {
        embedded.openDevTools();
        return;
      } catch (err) {
        console.warn('[plugin-node] failed to open plugin DevTools', err);
      }
    }
    console.warn('[plugin-node] no debuggable webview found for this plugin node');
  }, []);

  return (
    <div className={classes} style={wrapperStyle} onClick={handleNodeClick}>
      <CanvasNodeHeader
        fullscreenButton={fullscreenButton}
        containerDescendantCount={containerDescendantCount}
        handleClose={handleClose}
        handleFocus={handleFocus}
        handleHeaderMouseDown={handleHeaderMouseDown}
        handlePluginDevTools={handlePluginDevTools}
        handlePluginReload={handlePluginReload}
        handleReference={handleReference}
        handleAddToChat={handleAddToChat}
        handleTitleBlur={handleTitleBlur}
        handleTitleDoubleClick={handleTitleDoubleClick}
        handleTitleKeyDown={handleTitleKeyDown}
        handleUngroup={handleUngroup}
        isEditingTitle={isEditingTitle}
        isFullscreen={isFullscreen}
        isSelected={isSelected}
        node={node}
        onReference={onReference}
        onAddToChat={onAddToChat}
        onUngroupSelectedGroups={onUngroupSelectedGroups}
        onUpdate={onUpdate}
        readOnly={readOnly}
        relativeTime={relativeTime}
        titleRef={titleRef}
      />
      <div className="node-body" onMouseDown={handleNodeBodyMouseDown}>
        {node.type === 'file' ? (
          <FileNodeBody node={node} onUpdate={onUpdate} workspaceId={workspaceId} readOnly={readOnly} />
        ) : node.type === 'terminal' ? (
          <TerminalNodeBody node={node} getAllNodes={getAllNodes} rootFolder={rootFolder} workspaceId={workspaceId} workspaceName={workspaceName} onUpdate={onUpdate} readOnly={readOnly} />
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
            readOnly={readOnly}
          />
        ) : node.type === 'dynamic-app' ? (
          <DynamicAppNodeBody node={node} workspaceId={workspaceId} onUpdate={onUpdate} isResizing={isResizing} readOnly={readOnly} />
        ) : node.type === 'plugin' ? (
          <PluginNodeBody key={pluginReloadToken} node={node} workspaceId={workspaceId} workspaceName={workspaceName} onUpdate={onUpdate} isSelected={isSelected} readOnly={readOnly} />
        ) : (
          <AgentNodeBody node={node} getAllNodes={getAllNodes} rootFolder={rootFolder} workspaceId={workspaceId} workspaceName={workspaceName} onUpdate={onUpdate} readOnly={readOnly} />
        )}
      </div>
      <NodeResizeHandles
        isFullscreen={isFullscreen}
        makeResizeHandler={makeResizeHandler}
        nodeType={node.type}
        readOnly={readOnly}
      />
    </div>
  );
};
