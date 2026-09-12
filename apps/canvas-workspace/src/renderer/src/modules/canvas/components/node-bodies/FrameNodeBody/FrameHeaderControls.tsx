import { useCallback, type MouseEvent as ReactMouseEvent } from "react";
import type { CanvasNode, FrameNodeData } from "../../../../../types";
import { DropdownShell, SwatchRow } from "../../../../../components/ui";
import { useI18n } from "../../../../../i18n";

/**
 * Frame header controls (children toggle + color picker).
 *
 * Extracted from FrameNodeBody/index.tsx so the always-on CanvasNodeHeader can
 * import these without dragging the FrameNodeBody module — and through it
 * AgentTeamFrame -> AgentNodeBody -> @xterm/xterm — into the entry chunk
 * (C1/C6). This module is deliberately free of AgentTeamFrame and xterm; the
 * frame body itself (which does need AgentTeamFrame) lives in ./index.tsx,
 * now behind a React.lazy boundary.
 */

import { FRAME_COLOR_PRESETS as COLOR_PRESETS, resolveFrameAccent } from './colorPresets';

interface ColorPickerProps {
  node: CanvasNode;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
}

interface FrameChildrenToggleProps {
  node: CanvasNode;
  descendantCount: number;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  /** Display-only mode (read-only canvas preview): keep the collapse state
   *  and descendant count visible, but never write the toggle back. */
  readOnly?: boolean;
}

export const FrameChildrenToggle = ({
  node,
  descendantCount,
  onUpdate,
  readOnly = false,
}: FrameChildrenToggleProps) => {
  if (node.type !== 'frame') return null;
  const data = node.data as FrameNodeData;
  const collapsed = data.childrenCollapsed === true;
  const hasDescendants = descendantCount > 0;

  const handleToggle = useCallback(
    (e: ReactMouseEvent) => {
      e.stopPropagation();
      if (readOnly) return;
      onUpdate(node.id, {
        data: {
          ...data,
          childrenCollapsed: !collapsed,
        },
      });
    },
    [collapsed, data, node.id, onUpdate, readOnly],
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
          : readOnly
            ? `${descendantCount} frame children`
            : collapsed ? 'Show frame children' : 'Hide frame children'
      }
      aria-label={collapsed ? 'Show frame children' : 'Hide frame children'}
      aria-pressed={collapsed}
      disabled={!hasDescendants || readOnly}
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

  const handleColorChange = useCallback(
    (color: string) => {
      onUpdate(node.id, { data: { ...data, color } });
    },
    [data, onUpdate]
  );

  return (
    <DropdownShell
      className="frame-color-trigger"
      panelClassName="frame-color-popover"
      placement="top"
      align="center"
      role="menu"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          className="frame-color-dot"
          style={{ backgroundColor: resolveFrameAccent(data.color) }}
          title={t('canvas.frameStyle.color')}
          aria-label={t('canvas.frameStyle.color')}
          aria-haspopup="menu"
          aria-expanded={open}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
        />
      )}
    >
      {({ close }) => (
        <SwatchRow
          ariaLabel={t('canvas.frameStyle.color')}
          options={COLOR_PRESETS.map((preset) => ({
            value: preset.accent,
            label: t('canvas.frameStyle.colorOption', { name: preset.name }),
          }))}
          value={resolveFrameAccent(data.color)}
          onChange={(next) => {
            handleColorChange(COLOR_PRESETS.find((preset) => preset.accent === next)?.value ?? next);
            close();
          }}
        />
      )}
    </DropdownShell>
  );
};
