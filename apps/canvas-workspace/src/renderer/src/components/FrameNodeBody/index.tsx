import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import "./index.css";
import type { CanvasNode, FrameNodeData } from "../../types";
import { AgentTeamFrame } from "../AgentTeamFrame";
import { NodeTypeBadge } from "../CanvasNodeView/NodeTypeBadge";
import { useClickOutside } from "../../hooks/useClickOutside";
import { useMenuKeyboardNav } from "../../hooks/useMenuKeyboardNav";
import { useI18n } from "../../i18n";
import { collectDirectContainerChildren } from "../../utils/frameHierarchy";

/** Maximum direct-child rows shown in a collapsed frame before "+N more". */
const COLLAPSED_SUMMARY_MAX = 6;

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
  if (data.childrenCollapsed) {
    return <FrameCollapsedBody node={node} getAllNodes={getAllNodes} />;
  }
  return <div className="frame-body" />;
};

/* ---- Collapsed body: compact summary of hidden children ---- */

const FrameCollapsedBody = ({
  node,
  getAllNodes,
}: {
  node: CanvasNode;
  getAllNodes?: () => CanvasNode[];
}) => {
  const { t } = useI18n();
  const children = getAllNodes
    ? collectDirectContainerChildren(node.id, getAllNodes())
    : [];
  const visible = children.slice(0, COLLAPSED_SUMMARY_MAX);
  const remaining = children.length - visible.length;

  return (
    <div className="frame-body frame-body--collapsed">
      <ul className="frame-children-summary" aria-label={t('canvas.frameChildren.collapsedList')}>
        {visible.map((child) => (
          <li className="frame-children-summary__item" key={child.id}>
            <span className="frame-children-summary__icon">
              <NodeTypeBadge type={child.type} />
            </span>
            <span className="frame-children-summary__title">
              {child.title?.trim() || t('canvas.frameChildren.untitled')}
            </span>
          </li>
        ))}
        {remaining > 0 && (
          <li className="frame-children-summary__more">
            {t('canvas.frameChildren.collapsedMore', { count: remaining })}
          </li>
        )}
      </ul>
    </div>
  );
};

/* ---- Color picker (rendered in header) ---- */

// Muted frame palette. These are intentionally lower-chroma than the
// previous presets so large canvas frames read as organization, not alerts.
//
// Each preset is one hue around the wheel (coral -> amber -> olive -> sage
// -> teal -> sky -> indigo -> mauve + a low-chroma graphite slot). All
// derived tones (pill bg, pill text, body tint, border, dot pattern) are
// computed in CSS as `oklch(L C var(--frame-hue))`; see
// CanvasNodeView/utils.ts for the parse path.
//
// `value` is the identity swatch written into `data.color`. The 9th preset
// uses near-zero chroma so the frame reads as a quiet neutral.
const COLOR_PRESETS = [
  { name: "Coral",    hue: 28,  value: "oklch(0.68 0.108 28)"  },
  { name: "Amber",    hue: 58,  value: "oklch(0.68 0.108 58)"  },
  { name: "Olive",    hue: 98,  value: "oklch(0.68 0.108 98)"  },
  { name: "Sage",     hue: 142, value: "oklch(0.68 0.108 142)" },
  { name: "Teal",     hue: 184, value: "oklch(0.68 0.108 184)" },
  { name: "Sky",      hue: 224, value: "oklch(0.68 0.108 224)" },
  { name: "Indigo",   hue: 264, value: "oklch(0.68 0.108 264)" },
  { name: "Mauve",    hue: 318, value: "oklch(0.68 0.108 318)" },
  { name: "Graphite", hue: 265, value: "oklch(0.68 0.006 265)" }
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
  const { t } = useI18n();
  const data = node.data as FrameNodeData;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const handleColorChange = useCallback(
    (color: string) => {
      onUpdate(node.id, { data: { ...data, color } });
      setOpen(false);
    },
    [node.id, data, onUpdate]
  );

  const closePopover = useCallback(() => setOpen(false), []);
  useClickOutside(triggerRef, closePopover, open);
  useMenuKeyboardNav(popoverRef, closePopover, open);

  return (
    <div
      className={`frame-color-trigger${open ? ' frame-color-trigger--open' : ''}`}
      ref={triggerRef}
      title={t('canvas.frameStyle.color')}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="frame-color-dot"
        style={{ backgroundColor: data.color }}
        title={t('canvas.frameStyle.color')}
        aria-label={t('canvas.frameStyle.color')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      />
      {open && (
        <div
          ref={popoverRef}
          className="frame-color-popover frame-color-popover--open"
          role="menu"
          aria-label={t('canvas.frameStyle.color')}
        >
          {COLOR_PRESETS.map((preset) => (
            <button
              type="button"
              key={preset.name}
              className={`frame-color-swatch${data.color === preset.value ? ' frame-color-swatch--active' : ''}`}
              style={{ backgroundColor: preset.value }}
              role="menuitemradio"
              aria-checked={data.color === preset.value}
              title={t('canvas.frameStyle.colorOption', { name: preset.name })}
              aria-label={t('canvas.frameStyle.colorOption', { name: preset.name })}
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
