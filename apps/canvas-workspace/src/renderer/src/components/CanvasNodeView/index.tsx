import { useCallback, useState, useEffect, useRef } from "react";
import "./index.css";
import type { CanvasNode, FrameNodeData, AgentNodeData, TextNodeData } from "../../types";
import type { ResizeEdge } from "../../hooks/useNodeResize";
import { FileNodeBody } from "../FileNodeBody";
import { TerminalNodeBody } from "../TerminalNodeBody";
import { FrameNodeBody, FrameColorPicker } from "../FrameNodeBody";
import { AgentNodeBody } from "../AgentNodeBody";
import { TextNodeBody, TextColorPicker } from "../TextNodeBody";
import { IframeNodeBody } from "../IframeNodeBody";
import { ImageNodeBody } from "../ImageNodeBody";
import { ShapeNodeBody, ShapeStylePicker } from "../ShapeNodeBody";
import { MindmapNodeBody } from "../MindmapNodeBody";
import { NodeContextMenu } from "../NodeContextMenu";

interface Props {
  node: CanvasNode;
  allNodes: CanvasNode[];
  rootFolder?: string;
  workspaceId?: string;
  workspaceName?: string;
  isDragging: boolean;
  isResizing: boolean;
  isSelected: boolean;
  isHighlighted: boolean;
  /** True while this node is within the short window after a canvas-cli edit. */
  isAgentEdited?: boolean;
  onDragStart: (e: React.MouseEvent, node: CanvasNode) => void;
  onResizeStart: (
    e: React.MouseEvent,
    nodeId: string,
    width: number,
    height: number,
    edge: ResizeEdge,
    minWidth?: number,
    minHeight?: number
  ) => void;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  /** Dimension-only update that skips history. Content-sized nodes use
   *  this to reconcile their on-canvas bounds with their rendered body
   *  without polluting the undo stack. */
  onAutoResize: (id: string, width: number, height: number) => void;
  onRemove: (id: string) => void;
  onExportMindmapImage: (id: string) => void;
  /** Selection callback. The optional `mods` payload lets the caller
   *  honor shift/meta multi-select semantics — without it the click is
   *  treated as a plain replace-the-selection click. */
  onSelect: (id: string, mods?: { shift?: boolean; meta?: boolean }) => void;
  onFocus: (node: CanvasNode) => void;
  onReference?: (nodeId: string) => void;
  readOnly?: boolean;
}

function formatRelativeTime(epochMs: number): string {
  const diffSec = Math.floor((Date.now() - epochMs) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

const AGENT_STATUS_LABEL: Record<string, string> = {
  running: 'Running',
  done: 'Done',
  error: 'Error',
  idle: 'Idle',
};

export const CanvasNodeView = ({
  node,
  allNodes,
  rootFolder,
  workspaceId,
  workspaceName,
  isDragging,
  isResizing,
  isSelected,
  isHighlighted,
  isAgentEdited,
  onDragStart,
  onResizeStart,
  onUpdate,
  onAutoResize,
  onRemove,
  onExportMindmapImage,
  onSelect,
  onFocus,
  onReference,
  readOnly = false
}: Props) => {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [mindmapMenu, setMindmapMenu] = useState<{ x: number; y: number } | null>(null);
  const [, setTick] = useState(0);
  const titleRef = useRef<HTMLSpanElement>(null);

  // Re-render every 30s so relative time stays fresh
  useEffect(() => {
    if (!node.updatedAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [node.updatedAt]);

  const handleHeaderMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (readOnly) return;
      // Plain mousedown on an *unselected* node collapses the selection
      // to it so the drag in useNodeDrag has this node as its primary
      // (otherwise dragging a stranger node would still drag whatever
      // was previously selected). Shift/Cmd mousedowns intentionally
      // defer all selection mutation to the trailing click handler —
      // letting both fire would double-toggle and cancel out.
      const hasMods = e.shiftKey || e.metaKey || e.ctrlKey;
      if (!isSelected && !hasMods) onSelect(node.id);
      onDragStart(e, node);
    },
    [onSelect, onDragStart, node, isSelected, readOnly]
  );

  const handleNodeClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (readOnly) return;
      onSelect(node.id, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
    },
    [onSelect, node.id, readOnly]
  );

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (readOnly) return;
      onRemove(node.id);
    },
    [onRemove, node.id, readOnly]
  );

  const handleFocus = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onFocus(node);
    },
    [onFocus, node]
  );

  const handleReference = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (readOnly) return;
      onReference?.(node.id);
    },
    [onReference, node.id, readOnly]
  );

  const handleTitleBlur = useCallback(
    (e: React.FocusEvent<HTMLSpanElement>) => {
      if (readOnly) {
        setIsEditingTitle(false);
        return;
      }
      const newTitle = e.currentTarget.textContent?.trim();
      if (newTitle && newTitle !== node.title) {
        onUpdate(node.id, { title: newTitle });
      }
      setIsEditingTitle(false);
    },
    [onUpdate, node.id, node.title, readOnly]
  );

  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLSpanElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        titleRef.current?.blur();
      } else if (e.key === 'Escape') {
        if (titleRef.current) titleRef.current.textContent = node.title;
        titleRef.current?.blur();
      }
    },
    [node.title]
  );

  const handleTitleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (readOnly) return;
      setIsEditingTitle(true);
      // Focus after state update renders contentEditable=true
      requestAnimationFrame(() => {
        if (titleRef.current) {
          titleRef.current.focus();
          const range = document.createRange();
          range.selectNodeContents(titleRef.current);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      });
    },
    [readOnly]
  );

  const makeResizeHandler = useCallback(
    (edge: ResizeEdge) => (e: React.MouseEvent) => {
      if (node.type === "text") {
        const data = node.data as TextNodeData;
        if (data.autoSize !== false) {
          onUpdate(node.id, { data: { ...data, autoSize: false } });
        }
        onResizeStart(e, node.id, node.width, node.height, edge, 40, 28);
        return;
      }
      onResizeStart(e, node.id, node.width, node.height, edge);
    },
    [onResizeStart, onUpdate, node.id, node.type, node.width, node.height, node.data]
  );

  const textAutoSize =
    node.type === "text" && (node.data as TextNodeData).autoSize !== false;

  const classes = [
    "canvas-node",
    `canvas-node--${node.type}`,
    isDragging && "canvas-node--dragging",
    isResizing && "canvas-node--resizing",
    isSelected && "canvas-node--selected",
    isHighlighted && "canvas-node--highlighted",
    isAgentEdited && "canvas-node--agent-edited",
    readOnly && "canvas-node--readonly",
    textAutoSize && "canvas-node--text-auto"
  ]
    .filter(Boolean)
    .join(" ");

  const agentStatus = node.type === "agent"
    ? ((node.data as AgentNodeData).status ?? 'idle')
    : null;

  const relativeTime = node.updatedAt ? formatRelativeTime(node.updatedAt) : null;

  if (node.type === "image") {
    return (
      <div
        className={classes}
        style={{
          transform: `translate(${node.x}px, ${node.y}px)`,
          width: node.width,
          height: node.height,
        }}
        onClick={handleNodeClick}
      >
        <div className="node-body node-body--image" onMouseDown={(e) => e.stopPropagation()}>
          <ImageNodeBody node={node} onSelect={onSelect} onDragStart={onDragStart} readOnly={readOnly} />
        </div>
        {readOnly ? null : (
          <button className="node-close node-close--floating" onClick={handleClose} title="Remove">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        )}
        {readOnly ? null : (
          <>
            <div
              className="resize-handle resize-handle--right"
              onMouseDown={makeResizeHandler("right")}
            />
            <div
              className="resize-handle resize-handle--bottom"
              onMouseDown={makeResizeHandler("bottom")}
            />
            <div
              className="resize-handle resize-handle--corner"
              onMouseDown={makeResizeHandler("bottom-right")}
            />
          </>
        )}
      </div>
    );
  }

  if (node.type === "shape") {
    return (
      <div
        className={classes}
        style={{
          transform: `translate(${node.x}px, ${node.y}px)`,
          width: node.width,
          height: node.height,
        }}
        onClick={handleNodeClick}
      >
        <div className="node-body node-body--shape" onMouseDown={(e) => e.stopPropagation()}>
          <ShapeNodeBody
            node={node}
            isSelected={isSelected}
            onSelect={onSelect}
            onDragStart={onDragStart}
            onUpdate={onUpdate}
            readOnly={readOnly}
          />
        </div>
        {isSelected && !readOnly && <ShapeStylePicker node={node} onUpdate={onUpdate} />}
        {readOnly ? null : (
          <button className="node-close node-close--floating" onClick={handleClose} title="Remove">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        )}
        {readOnly ? null : (
          <>
            <div
              className="resize-handle resize-handle--right"
              onMouseDown={makeResizeHandler("right")}
            />
            <div
              className="resize-handle resize-handle--bottom"
              onMouseDown={makeResizeHandler("bottom")}
            />
            <div
              className="resize-handle resize-handle--corner"
              onMouseDown={makeResizeHandler("bottom-right")}
            />
          </>
        )}
      </div>
    );
  }

  if (node.type === "mindmap") {
    return (
      <div
        className={classes}
        style={{
          transform: `translate(${node.x}px, ${node.y}px)`,
          width: node.width,
          height: node.height,
        }}
        onClick={handleNodeClick}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (readOnly) return;
          onSelect(node.id);
          setMindmapMenu({ x: e.clientX, y: e.clientY });
        }}
        onMouseDown={(e) => {
          if (readOnly) return;
          // Same logic as handleHeaderMouseDown — only collapse the
          // selection on a plain mousedown over an unselected node.
          // Shift/Cmd selection changes are handled exclusively by the
          // click handler.
          const hasMods = e.shiftKey || e.metaKey || e.ctrlKey;
          if (!isSelected && !hasMods) onSelect(node.id);
          onDragStart(e, node);
        }}
      >
        <div className="node-body node-body--mindmap">
          <MindmapNodeBody
            node={node}
            isSelected={isSelected}
            isOuterDragging={isDragging}
            onUpdate={onUpdate}
            onSelectNode={onSelect}
            onAutoResize={onAutoResize}
            readOnly={readOnly}
          />
        </div>
        {readOnly ? null : (
          <button className="node-close node-close--floating" onClick={handleClose} title="Remove">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        )}
        {mindmapMenu && (
          <NodeContextMenu
            x={mindmapMenu.x}
            y={mindmapMenu.y}
            mode="mindmap"
            onClose={() => setMindmapMenu(null)}
            onExportImage={() => {
              setMindmapMenu(null);
              onExportMindmapImage(node.id);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div
      className={classes}
      style={{
        transform: `translate(${node.x}px, ${node.y}px)`,
        width: node.width,
        height: node.height,
        ...(node.type === 'frame'
          ? { '--frame-color': (node.data as FrameNodeData).color } as React.CSSProperties
          : {})
      }}
      onClick={handleNodeClick}
    >
      <div
        className="node-header"
        onMouseDown={handleHeaderMouseDown}
      >
        <span className={`node-type-badge node-type-badge--${node.type}`}>
          {node.type === "file" ? (
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M3 3h10v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3z" stroke="currentColor" strokeWidth="1.3" />
              <path d="M5.5 7h5M5.5 9.5h3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          ) : node.type === "terminal" ? (
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
              <path d="M4.5 7l2 1.5-2 1.5M8 10.5h3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : node.type === "frame" ? (
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" />
              <rect x="4.5" y="4.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1" strokeDasharray="2 1.5" />
            </svg>
          ) : node.type === "text" ? (
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M3 4h10M8 4v9M6 13h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          ) : node.type === "iframe" ? (
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
              <path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="5.5" r="3" stroke="currentColor" strokeWidth="1.3" />
              <path d="M4 14c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <circle cx="6.5" cy="5" r="0.8" fill="currentColor" />
              <circle cx="9.5" cy="5" r="0.8" fill="currentColor" />
            </svg>
          )}
          {node.type === "agent" && agentStatus && agentStatus !== "idle" && (
            <span className={`node-status-dot node-status-dot--${agentStatus}`} />
          )}
        </span>
        <span
          ref={titleRef}
          className="node-title"
          contentEditable={isEditingTitle}
          suppressContentEditableWarning
          spellCheck={false}
          onBlur={handleTitleBlur}
          onKeyDown={isEditingTitle ? handleTitleKeyDown : undefined}
          onDoubleClick={handleTitleDoubleClick}
          onMouseDown={(e) => {
            if (isEditingTitle) e.stopPropagation();
          }}
        >
          {node.title}
        </span>
        {node.type === "agent" && agentStatus && agentStatus !== 'idle' && (
          <span className={`node-status-label node-status-label--${agentStatus}`}>
            {AGENT_STATUS_LABEL[agentStatus] ?? agentStatus}
          </span>
        )}
        {relativeTime && !(node.type === "agent" && agentStatus && agentStatus !== 'idle') && (
          <span className="node-time-label" title={new Date(node.updatedAt!).toLocaleString()}>
            {relativeTime}
          </span>
        )}
        {node.type === "frame" && !readOnly && (
          <FrameColorPicker node={node} onUpdate={onUpdate} />
        )}
        {node.type === "text" && !readOnly && (
          <TextColorPicker node={node} onUpdate={onUpdate} />
        )}
        {!readOnly && onReference ? (
          <button className="node-reference" onClick={handleReference} title="Reference">
            Reference
          </button>
        ) : null}
        <button className="node-focus" onClick={handleFocus} title="Focus">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M6 1v2M6 9v2M1 6h2M9 6h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
        {readOnly ? null : (
          <button className="node-close" onClick={handleClose} title="Remove">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
      <div className="node-body" onMouseDown={(e) => e.stopPropagation()}>
        {node.type === "file" ? (
          <FileNodeBody node={node} onUpdate={onUpdate} workspaceId={workspaceId} readOnly={readOnly} />
        ) : node.type === "terminal" ? (
          <TerminalNodeBody node={node} allNodes={allNodes} rootFolder={rootFolder} workspaceId={workspaceId} workspaceName={workspaceName} onUpdate={onUpdate} readOnly={readOnly} />
        ) : node.type === "frame" ? (
          <FrameNodeBody node={node} onUpdate={onUpdate} />
        ) : node.type === "text" ? (
          <TextNodeBody
            node={node}
            onUpdate={onUpdate}
            isSelected={isSelected}
            onSelect={onSelect}
            onDragStart={onDragStart}
            readOnly={readOnly}
          />
        ) : node.type === "iframe" ? (
          <IframeNodeBody node={node} workspaceId={workspaceId} onUpdate={onUpdate} isResizing={isResizing} readOnly={readOnly} />
        ) : (
          <AgentNodeBody node={node} allNodes={allNodes} rootFolder={rootFolder} workspaceId={workspaceId} workspaceName={workspaceName} onUpdate={onUpdate} readOnly={readOnly} />
        )}
      </div>

        {readOnly ? null : (
          <>
            <div
              className="resize-handle resize-handle--right"
              onMouseDown={makeResizeHandler("right")}
            />
            {node.type !== "text" && (
              <>
                <div
                  className="resize-handle resize-handle--bottom"
                  onMouseDown={makeResizeHandler("bottom")}
                />
                <div
                  className="resize-handle resize-handle--corner"
                  onMouseDown={makeResizeHandler("bottom-right")}
                />
              </>
            )}
          </>
        )}
    </div>
  );
};
