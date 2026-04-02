import { useCallback } from "react";
import type { CanvasNode, FrameNodeData, AgentNodeData, AgentRuntime, TeamPlanData } from "../../types";
import type { ResizeEdge } from "../../hooks/useNodeResize";
import { FileNodeBody } from "../FileNodeBody";
import { TerminalNodeBody } from "../TerminalNodeBody";
import { FrameNodeBody, FrameColorPicker } from "../FrameNodeBody";
import { AgentNodeBody } from "../AgentNodeBody";
import { canvasToTeamConfig } from "../../utils/teamConfig";

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
  onDragStart: (e: React.MouseEvent, node: CanvasNode) => void;
  onResizeStart: (
    e: React.MouseEvent,
    nodeId: string,
    width: number,
    height: number,
    edge: ResizeEdge
  ) => void;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  onRemove: (id: string) => void;
  onSelect: (id: string) => void;
  onFocus: (node: CanvasNode) => void;
  onAddNode?: (type: 'agent', x: number, y: number, data?: Partial<AgentNodeData>) => CanvasNode;
}

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
  onDragStart,
  onResizeStart,
  onUpdate,
  onRemove,
  onSelect,
  onFocus,
  onAddNode,
}: Props) => {
  const handleHeaderMouseDown = useCallback(
    (e: React.MouseEvent) => {
      onSelect(node.id);
      onDragStart(e, node);
    },
    [onSelect, onDragStart, node]
  );

  const handleNodeClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect(node.id);
    },
    [onSelect, node.id]
  );

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onRemove(node.id);
    },
    [onRemove, node.id]
  );

  const handleFocus = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onFocus(node);
    },
    [onFocus, node]
  );

  const handleTitleChange = useCallback(
    (e: React.FocusEvent<HTMLSpanElement>) => {
      const newTitle = e.currentTarget.textContent?.trim();
      if (newTitle && newTitle !== node.title) {
        onUpdate(node.id, { title: newTitle });
      }
    },
    [onUpdate, node.id, node.title]
  );

  const makeResizeHandler = useCallback(
    (edge: ResizeEdge) => (e: React.MouseEvent) => {
      onResizeStart(e, node.id, node.width, node.height, edge);
    },
    [onResizeStart, node.id, node.width, node.height]
  );

  const classes = [
    "canvas-node",
    `canvas-node--${node.type}`,
    isDragging && "canvas-node--dragging",
    isResizing && "canvas-node--resizing",
    isSelected && "canvas-node--selected",
    isHighlighted && "canvas-node--highlighted"
  ]
    .filter(Boolean)
    .join(" ");

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
          ) : node.type === "agent" ? (
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.3" />
              <path d="M3.5 13.5c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" />
              <rect x="4.5" y="4.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1" strokeDasharray="2 1.5" />
            </svg>
          )}
        </span>
        <span
          className="node-title"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          onBlur={handleTitleChange}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {node.title}
        </span>
        {node.type === "frame" && (
          <>
            <button
              className={`frame-team-toggle${(node.data as FrameNodeData).isTeam ? ' frame-team-toggle--active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                const fd = node.data as FrameNodeData;
                const isTeam = !fd.isTeam;
                onUpdate(node.id, {
                  data: {
                    ...fd,
                    isTeam,
                    teamId: isTeam ? (fd.teamId || `team-${node.id}`) : fd.teamId,
                    teamName: isTeam ? (fd.teamName || node.title) : fd.teamName,
                    teamStatus: isTeam ? (fd.teamStatus || 'idle') : fd.teamStatus,
                  },
                });
              }}
              onMouseDown={(e) => e.stopPropagation()}
              title={(node.data as FrameNodeData).isTeam ? 'Unmark as Team' : 'Mark as Team'}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <circle cx="6" cy="5" r="2" stroke="currentColor" strokeWidth="1.2" />
                <circle cx="11" cy="5" r="2" stroke="currentColor" strokeWidth="1.2" />
                <path d="M2 13c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <path d="M10 9.5c1.4.5 2.5 1.8 2.5 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>
            <FrameColorPicker node={node} onUpdate={onUpdate} />
          </>
        )}
        <button className="node-focus" onClick={handleFocus} title="Focus">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M6 1v2M6 9v2M1 6h2M9 6h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
        <button className="node-close" onClick={handleClose} title="Remove">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="node-body" onMouseDown={(e) => e.stopPropagation()}>
        {node.type === "file" ? (
          <FileNodeBody node={node} onUpdate={onUpdate} workspaceId={workspaceId} />
        ) : node.type === "terminal" ? (
          <TerminalNodeBody node={node} allNodes={allNodes} rootFolder={rootFolder} workspaceId={workspaceId} workspaceName={workspaceName} onUpdate={onUpdate} />
        ) : node.type === "agent" ? (
          <AgentNodeBody node={node} onUpdate={onUpdate} />
        ) : (
          <FrameNodeBody
            node={node}
            onUpdate={onUpdate}
            onRunTeam={(node.data as FrameNodeData).isTeam ? () => {
              const api = window.canvasWorkspace?.agentTeam;
              if (!api) return;
              const config = canvasToTeamConfig(node, allNodes);
              if (!config) return;
              onUpdate(node.id, { data: { ...node.data, teamStatus: 'running' } });
              api.runTeam(config).then((result) => {
                if (!result.ok) {
                  onUpdate(node.id, { data: { ...node.data, teamStatus: 'failed' } });
                }
              });
            } : undefined}
            onStopTeam={(node.data as FrameNodeData).isTeam ? () => {
              const api = window.canvasWorkspace?.agentTeam;
              const teamId = (node.data as FrameNodeData).teamId;
              if (!api || !teamId) return;
              api.stopTeam(teamId).then(() => {
                onUpdate(node.id, { data: { ...node.data, teamStatus: 'idle' } });
              });
            } : undefined}
            onCreateAgentsFromPlan={onAddNode ? (plan: TeamPlanData) => {
              const padding = 20;
              const agentW = 500;
              const agentH = 450;
              const cols = Math.max(1, Math.floor((node.width - padding * 2) / (agentW + padding)));

              plan.teammates.forEach((t, i) => {
                const col = i % cols;
                const row = Math.floor(i / cols);
                const x = node.x + padding + col * (agentW + padding);
                const y = node.y + 120 + row * (agentH + padding); // 120px offset for frame header+bar+goal

                onAddNode('agent', x, y, {
                  name: t.name,
                  role: t.role,
                  runtime: 'pulse-agent' as AgentRuntime,
                  isLead: i === 0,
                  model: t.model,
                  spawnPrompt: t.spawnPrompt,
                  teamId: (node.data as FrameNodeData).teamId || `team-${node.id}`,
                  teammateId: t.name,
                  status: 'idle',
                  mode: 'pty',
                });
              });

              // Resize frame to fit agents
              const totalRows = Math.ceil(plan.teammates.length / cols);
              const neededH = 120 + totalRows * (agentH + padding) + padding;
              const neededW = padding + cols * (agentW + padding);
              if (neededW > node.width || neededH > node.height) {
                onUpdate(node.id, {
                  width: Math.max(node.width, neededW),
                  height: Math.max(node.height, neededH),
                });
              }
            } : undefined}
          />
        )}
      </div>

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
    </div>
  );
};
