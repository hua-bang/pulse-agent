import { useCallback } from "react";
import type { CanvasNode, FrameNodeData } from "../types";

interface Props {
  node: CanvasNode;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
}

const COLOR_PRESETS = [
  { name: "Purple", value: "#9065b0" },
  { name: "Blue", value: "#2383e2" },
  { name: "Green", value: "#0f7b6c" },
  { name: "Yellow", value: "#cb912f" },
  { name: "Red", value: "#e03e3e" },
  { name: "Gray", value: "#787774" }
];

export const FrameNodeBody = ({ node, onUpdate }: Props) => {
  const data = node.data as FrameNodeData;

  const handleColorChange = useCallback(
    (color: string) => {
      onUpdate(node.id, { data: { ...data, color } });
    },
    [node.id, data, onUpdate]
  );

  return (
    <div className="frame-body">
      <div className="frame-colors">
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
