import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import "./index.css";
import type { CanvasNode, FrameNodeData } from "../../types";
import { AgentTeamFrame } from "../AgentTeamFrame";
import { useEscapeClose } from "../../hooks/useEscapeClose";

interface Props {
  node: CanvasNode;
  getAllNodes?: () => CanvasNode[];
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  onRemoveNodes?: (ids: string[]) => void;
  rootFolder?: string;
  workspaceId?: string;
  workspaceName?: string;
  readOnly?: boolean;
}

export const FrameNodeBody = ({
  node,
  getAllNodes,
  onUpdate,
  onRemoveNodes,
  rootFolder,
  workspaceId,
  workspaceName,
  readOnly,
}: Props) => {
  const data = node.data as FrameNodeData;
  if (data.agentTeamId) {
    return (
      <AgentTeamFrame
        node={node}
        getAllNodes={getAllNodes}
        onUpdate={onUpdate}
        onRemoveNodes={onRemoveNodes}
        rootFolder={rootFolder}
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        readOnly={readOnly}
      />
    );
  }
  return <div className="frame-body" />;
};

/* ---- Color picker (rendered in header) ---- */

// FigJam-style soft palette: L≈70, S≈55%, hues evenly distributed.
// These read as a cohesive family and produce good dark-text contrast in the
// narrow header tab (see FrameNodeBody/index.css).
const COLOR_PRESETS = [
  { name: "Red", value: "#F08F82" },
  { name: "Orange", value: "#F5B36B" },
  { name: "Yellow", value: "#E8C468" },
  { name: "Green", value: "#7BC89B" },
  { name: "Teal", value: "#6FBFC7" },
  { name: "Blue", value: "#7AA7E8" },
  { name: "Purple", value: "#A594E0" },
  { name: "Pink", value: "#E89BBF" },
  { name: "Gray", value: "#A8B0BD" }
];

interface ColorPickerProps {
  node: CanvasNode;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
}

interface FrameChildrenToggleProps {
  node: CanvasNode;
  descendantCount: number;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
}

export const FrameChildrenToggle = ({
  node,
  descendantCount,
  onUpdate,
}: FrameChildrenToggleProps) => {
  if (node.type !== 'frame') return null;
  const data = node.data as FrameNodeData;
  const collapsed = data.childrenCollapsed === true;
  const hasDescendants = descendantCount > 0;

  const handleToggle = useCallback(
    (e: ReactMouseEvent) => {
      e.stopPropagation();
      onUpdate(node.id, {
        data: {
          ...data,
          childrenCollapsed: !collapsed,
        },
      });
    },
    [collapsed, data, node.id, onUpdate],
  );

  return (
    <button
      className={`frame-children-toggle${collapsed ? ' frame-children-toggle--collapsed' : ''}`}
      type="button"
      onClick={handleToggle}
      onMouseDown={(e) => e.stopPropagation()}
      title={
        !hasDescendants
          ? 'No frame children'
          : collapsed ? 'Show frame children' : 'Hide frame children'
      }
      aria-label={collapsed ? 'Show frame children' : 'Hide frame children'}
      aria-pressed={collapsed}
      disabled={!hasDescendants}
    >
      <FrameToggleIcon collapsed={collapsed} />
      <span className="frame-children-count">{descendantCount}</span>
    </button>
  );
};

const FrameToggleIcon = ({ collapsed }: { collapsed: boolean }) => (
  <svg
    className="frame-children-toggle-icon"
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
  >
    <path
      className="frame-children-toggle-icon__rail frame-children-toggle-icon__rail--top"
      d="M4.25 4.25h7.5"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
    <path
      className="frame-children-toggle-icon__chevron"
      d="M5 6.75l3 3 3-3"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      className="frame-children-toggle-icon__rail frame-children-toggle-icon__rail--bottom"
      d="M4.25 11.75h7.5"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
    <title>{collapsed ? 'Expand frame children' : 'Collapse frame children'}</title>
  </svg>
);

export const FrameColorPicker = ({ node, onUpdate }: ColorPickerProps) => {
  const data = node.data as FrameNodeData;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);

  const handleColorChange = useCallback(
    (color: string) => {
      onUpdate(node.id, { data: { ...data, color } });
      setOpen(false);
    },
    [node.id, data, onUpdate]
  );

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  useEscapeClose(open, () => setOpen(false));

  return (
    <div
      className={`frame-color-trigger${open ? ' frame-color-trigger--open' : ''}`}
      ref={triggerRef}
      title="Frame color"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="frame-color-dot"
        style={{ backgroundColor: data.color }}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      />
      {open && (
        <div className="frame-color-popover frame-color-popover--open">
          {COLOR_PRESETS.map((preset) => (
            <button
              key={preset.name}
              className={`frame-color-swatch${data.color === preset.value ? ' frame-color-swatch--active' : ''}`}
              style={{ backgroundColor: preset.value }}
              title={preset.name}
              onClick={(e) => {
                e.stopPropagation();
                handleColorChange(preset.value);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
};
