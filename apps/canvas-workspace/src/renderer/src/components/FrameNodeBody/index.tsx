import { useCallback, useState } from "react";
import type { CanvasNode, FrameNodeData } from "../../types";

interface Props {
  node: CanvasNode;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  onRunTeam?: () => void;
  onStopTeam?: () => void;
}

const TEAM_STATUS_LABELS: Record<string, string> = {
  idle: 'Ready',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
};

const TEAM_STATUS_COLORS: Record<string, string> = {
  idle: '#9ca3af',
  running: '#22c55e',
  completed: '#22c55e',
  failed: '#ef4444',
};

export const FrameNodeBody = ({ node, onUpdate, onRunTeam, onStopTeam }: Props) => {
  const data = node.data as FrameNodeData;

  if (!data.isTeam) {
    return <div className="frame-body" />;
  }

  return (
    <div className="frame-body frame-body--team">
      <div className="frame-team-bar">
        <div className="frame-team-bar-left">
          <span
            className="frame-team-status-dot"
            style={{ backgroundColor: TEAM_STATUS_COLORS[data.teamStatus || 'idle'] }}
          />
          <span className="frame-team-status-label">
            {TEAM_STATUS_LABELS[data.teamStatus || 'idle']}
          </span>
        </div>
        <div className="frame-team-bar-right">
          {(!data.teamStatus || data.teamStatus === 'idle' || data.teamStatus === 'completed' || data.teamStatus === 'failed') && onRunTeam && (
            <button
              className="agent-btn agent-btn--primary agent-btn--small"
              onClick={(e) => { e.stopPropagation(); onRunTeam(); }}
              title="Run Team"
            >
              &#9654; Run Team
            </button>
          )}
          {data.teamStatus === 'running' && onStopTeam && (
            <button
              className="agent-btn agent-btn--secondary agent-btn--small"
              onClick={(e) => { e.stopPropagation(); onStopTeam(); }}
              title="Stop Team"
            >
              &#9632; Stop Team
            </button>
          )}
        </div>
      </div>
      <FrameGoalEditor node={node} onUpdate={onUpdate} />
    </div>
  );
};

/* ---- Goal Editor ---- */

const FrameGoalEditor = ({ node, onUpdate }: { node: CanvasNode; onUpdate: (id: string, patch: Partial<CanvasNode>) => void }) => {
  const data = node.data as FrameNodeData;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.goal || '');

  const handleSave = useCallback(() => {
    onUpdate(node.id, { data: { ...data, goal: draft } });
    setEditing(false);
  }, [node.id, data, draft, onUpdate]);

  if (editing) {
    return (
      <div className="frame-goal-editor">
        <textarea
          className="frame-goal-textarea"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onMouseDown={(e) => e.stopPropagation()}
          placeholder="Describe the team's goal..."
          autoFocus
          rows={3}
        />
        <div className="frame-goal-actions">
          <button
            className="agent-btn agent-btn--primary agent-btn--small"
            onClick={(e) => { e.stopPropagation(); handleSave(); }}
          >
            Save
          </button>
          <button
            className="agent-btn agent-btn--secondary agent-btn--small"
            onClick={(e) => { e.stopPropagation(); setEditing(false); setDraft(data.goal || ''); }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="frame-goal-display"
      onClick={(e) => { e.stopPropagation(); setEditing(true); setDraft(data.goal || ''); }}
      title="Click to edit goal"
    >
      {data.goal ? (
        <span className="frame-goal-text">{data.goal}</span>
      ) : (
        <span className="frame-goal-placeholder">Click to set team goal...</span>
      )}
    </div>
  );
};

/* ---- Color picker (rendered in header) ---- */

const COLOR_PRESETS = [
  { name: "Red", value: "#e03e3e" },
  { name: "Orange", value: "#d9730d" },
  { name: "Yellow", value: "#cb912f" },
  { name: "Green", value: "#0f7b6c" },
  { name: "Cyan", value: "#2e9e9e" },
  { name: "Blue", value: "#2383e2" },
  { name: "Purple", value: "#9065b0" },
  { name: "Pink", value: "#c84c8a" },
  { name: "Gray", value: "#787774" }
];

interface ColorPickerProps {
  node: CanvasNode;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
}

export const FrameColorPicker = ({ node, onUpdate }: ColorPickerProps) => {
  const data = node.data as FrameNodeData;

  const handleColorChange = useCallback(
    (color: string) => {
      onUpdate(node.id, { data: { ...data, color } });
    },
    [node.id, data, onUpdate]
  );

  return (
    <div className="frame-color-trigger" title="Frame color">
      <div className="frame-color-dot" style={{ backgroundColor: data.color }} />
      <div className="frame-color-popover">
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
    </div>
  );
};
