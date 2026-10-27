export type ColorPreset = { name: string; value: string };

/** Ink stored on new text nodes; it means "default", not a fixed color. */
const DEFAULT_TEXT_INK = "#1f2328";

/**
 * Inline color for a text node. The default ink returns undefined so the
 * body takes the theme's text color and stays readable in dark mode.
 */
export const resolveTextNodeColor = (color: string | undefined): string | undefined =>
  !color || color.toLowerCase() === DEFAULT_TEXT_INK ? undefined : color;

export const TEXT_COLOR_PRESETS: ColorPreset[] = [
  { name: "Black", value: DEFAULT_TEXT_INK },
  { name: "Gray", value: "#6b7280" },
  { name: "Red", value: "#e03131" },
  { name: "Orange", value: "#f08c00" },
  { name: "Yellow", value: "#e8b800" },
  { name: "Green", value: "#2f9e44" },
  { name: "Blue", value: "#1c7ed6" },
  { name: "Purple", value: "#7048e8" },
  { name: "White", value: "#ffffff" },
];

export const BG_COLOR_PRESETS: ColorPreset[] = [
  { name: "None", value: "transparent" },
  { name: "White", value: "#ffffff" },
  { name: "Gray", value: "#e9ecef" },
  { name: "Red", value: "#ffe3e3" },
  { name: "Orange", value: "#ffe8cc" },
  { name: "Yellow", value: "#fff3bf" },
  { name: "Green", value: "#d3f9d8" },
  { name: "Blue", value: "#d0ebff" },
  { name: "Purple", value: "#e5dbff" },
];

export const HIGHLIGHT_COLOR_PRESETS: ColorPreset[] = [
  { name: "Yellow", value: "#fff3bf" },
  { name: "Green", value: "#d3f9d8" },
  { name: "Blue", value: "#d0ebff" },
  { name: "Purple", value: "#e5dbff" },
  { name: "Red", value: "#ffe3e3" },
  { name: "Orange", value: "#ffe8cc" },
];
