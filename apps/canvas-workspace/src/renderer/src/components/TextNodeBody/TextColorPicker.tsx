import { BG_COLOR_PRESETS, TEXT_COLOR_PRESETS } from "./colorPresets";
import type { CanvasNode, TextNodeData } from "../../types";
import { DropdownShell, SwatchRow } from "../ui";
import { useI18n } from "../../i18n";

/**
 * Color pickers for the text-node header (text color + background color).
 *
 * Extracted from TextNodeBody/index.tsx so the always-on CanvasNodeHeader can
 * import these without dragging @tiptap/react into the entry chunk (C1/C6).
 * This module is deliberately tiptap-free: it only renders preset swatches and
 * writes the chosen value back through `onUpdate`. The tiptap-backed editor
 * lives in ./index.tsx, which is now behind a React.lazy boundary.
 */

type PickerKind = "text" | "bg";

const TextColorTrigger = ({
  node,
  onUpdate,
  kind,
}: {
  node: CanvasNode;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  kind: PickerKind;
}) => {
  const { t } = useI18n();
  const data = node.data as TextNodeData;

  const currentValue = kind === "text" ? data.textColor : data.backgroundColor;
  const presets = kind === "text" ? TEXT_COLOR_PRESETS : BG_COLOR_PRESETS;
  const title = kind === "text" ? t('canvas.textStyle.textColor') : t('canvas.textStyle.backgroundColor');
  const optionLabelKey = kind === "text" ? 'canvas.textStyle.textColorOption' : 'canvas.textStyle.backgroundColorOption';

  const isTransparent = currentValue === "transparent";

  return (
    <DropdownShell
      className="text-color-trigger"
      panelClassName="text-color-popover"
      placement="bottom"
      align="center"
      role="menu"
      // preventDefault across the WHOLE panel (padding and gaps included, not
      // just the swatches) keeps the editor focused while picking a color —
      // the pre-migration wrapper guarded the full surface.
      onPanelMouseDown={(e) => e.preventDefault()}
      trigger={({ open, toggle }) => (
        <button
          type="button"
          className={`text-color-dot${isTransparent ? " text-color-dot--transparent" : ""}`}
          style={{ backgroundColor: isTransparent ? undefined : currentValue }}
          title={title}
          aria-label={title}
          aria-haspopup="menu"
          aria-expanded={open}
          // preventDefault on mousedown keeps the editor focused when the
          // user reaches for a color while editing — no exit-and-re-enter
          // ceremony.
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
        >
          {kind === "text" && <span className="text-color-dot-glyph">A</span>}
        </button>
      )}
    >
      {({ close }) => (
        <SwatchRow
          ariaLabel={title}
          options={presets.map((preset) => ({
            value: preset.value,
            label: t(optionLabelKey, { name: preset.name }),
            isNone: preset.value === "transparent",
          }))}
          value={currentValue}
          onChange={(next) => {
            const patch: Partial<TextNodeData> =
              kind === "text" ? { textColor: next } : { backgroundColor: next };
            onUpdate(node.id, { data: { ...data, ...patch } });
            close();
          }}
        />
      )}
    </DropdownShell>
  );
};

export const TextColorPicker = ({
  node,
  onUpdate,
}: {
  node: CanvasNode;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
}) => (
  <>
    <TextColorTrigger node={node} onUpdate={onUpdate} kind="text" />
    <TextColorTrigger node={node} onUpdate={onUpdate} kind="bg" />
  </>
);
