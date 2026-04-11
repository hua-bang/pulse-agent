import { useCallback, useEffect, useRef, useState } from "react";
import "./index.css";
import type { CanvasNode, FrameNodeData } from "../../types";

interface Props {
  node: CanvasNode;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
}

export const FrameNodeBody = ({ node: _node, onUpdate: _onUpdate }: Props) => {
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
