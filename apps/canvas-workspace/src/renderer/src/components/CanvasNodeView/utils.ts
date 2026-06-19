import type { CSSProperties, MouseEvent } from 'react';
import type { CanvasNode, FrameNodeData, GroupNodeData, TextNodeData } from '../../types';

export function formatRelativeTime(epochMs: number): string {
  const diffSec = Math.floor((Date.now() - epochMs) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

export function isCanvasPanGesture(e: MouseEvent): boolean {
  const handToolActive = e.currentTarget.closest('.canvas-container--hand') != null;
  return e.button === 1 || (e.button === 0 && (e.altKey || handToolActive));
}

export const getTextAutoSize = (node: CanvasNode) => (
  node.type === 'text' && (node.data as TextNodeData).autoSize !== false
);

export const getNodeClasses = ({
  embedded,
  focusState,
  isAgentEdited,
  isDragging,
  isFullscreen,
  isHighlighted,
  isResizing,
  isSelected,
  node,
  readOnly,
  textAutoSize,
}: {
  embedded: boolean;
  focusState: 'focused' | 'context' | 'dimmed' | 'neutral';
  isAgentEdited?: boolean;
  isDragging: boolean;
  isFullscreen: boolean;
  isHighlighted: boolean;
  isResizing: boolean;
  isSelected: boolean;
  node: CanvasNode;
  readOnly: boolean;
  textAutoSize: boolean;
}) => [
  'canvas-node',
  `canvas-node--${node.type}`,
  isDragging && 'canvas-node--dragging',
  isResizing && 'canvas-node--resizing',
  isSelected && 'canvas-node--selected',
  isHighlighted && 'canvas-node--highlighted',
  isAgentEdited && 'canvas-node--agent-edited',
  focusState === 'focused' && 'canvas-node--focus-mode-focused',
  focusState === 'context' && 'canvas-node--focus-mode-context',
  focusState === 'dimmed' && 'canvas-node--focus-mode-dimmed',
  readOnly && 'canvas-node--readonly',
  embedded && 'canvas-node--embedded',
  textAutoSize && 'canvas-node--text-auto',
  isFullscreen && 'canvas-node--fullscreen',
]
  .filter(Boolean)
  .join(' ');

/* Frame palette (matches design/frame-color.html "Soft" palette).
 *
 * Each frame's tones (pill bg, pill text, body tint, border, dot pattern)
 * are derived in CSS via oklch(L C var(--frame-hue)) with fixed L/C math.
 * To support that, this helper parses the stored color into a hue number
 * (and chroma, used to flag the low-chroma "graphite" preset).
 *
 * Storage compatibility:
 *  - New presets (`COLOR_PRESETS` in FrameNodeBody/index.tsx) write
 *    `oklch(0.66 0.155 <hue>)`; we extract <hue> directly.
 *  - Legacy hex values (FigJam-era presets, demo workspaces) are converted
 *    via HSL — for the warm pastel range these were drawn from, HSL hue is
 *    within ~5–10° of oklch hue, which is good enough for the design's
 *    soft tones.
 *  - Anything unparseable falls back to hue 250 (a neutral indigo).
 */
const DEFAULT_FRAME_HUE = 250;
const DEFAULT_FRAME_CHROMA = 0.072;

const parseOklchTriple = (color: string): { hue: number; chroma: number } | null => {
  const m = color.match(/oklch\(\s*[\d.]+\s+([\d.]+)\s+([\d.]+)/i);
  if (!m) return null;
  const chroma = Number(m[1]);
  const hue = Number(m[2]);
  if (!Number.isFinite(chroma) || !Number.isFinite(hue)) return null;
  return { hue, chroma };
};

const hexToHue = (color: string): number | null => {
  const m = color.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const n = parseInt(hex, 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 0.01) return DEFAULT_FRAME_HUE; // achromatic gray
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return h;
};

const resolveFrameHue = (color: string): { hue: number; chroma: number } => {
  const parsed = parseOklchTriple(color);
  if (parsed) {
    // Stored chroma is the *saturated identity* (~0.155); we want the
    // palette's working chroma (0.072) for derived tones, except when the
    // preset is intentionally low-chroma (graphite, ~0.006).
    return {
      hue: parsed.hue,
      chroma: parsed.chroma < 0.02 ? 0.006 : DEFAULT_FRAME_CHROMA,
    };
  }
  const hue = hexToHue(color);
  if (hue !== null) return { hue, chroma: DEFAULT_FRAME_CHROMA };
  return { hue: DEFAULT_FRAME_HUE, chroma: DEFAULT_FRAME_CHROMA };
};

export const getNodeWrapperStyle = (node: CanvasNode): CSSProperties => {
  const base: CSSProperties = {
    transform: `translate(${node.x}px, ${node.y}px)`,
    width: node.width,
    height: node.height,
  };
  if (node.type === 'frame') {
    const color = (node.data as FrameNodeData).color;
    const { hue, chroma } = resolveFrameHue(color);
    return {
      ...base,
      '--frame-color': color,
      '--frame-hue': String(hue),
      '--frame-chroma': String(chroma),
    } as CSSProperties;
  }
  if (node.type === 'group') {
    return {
      ...base,
      '--group-color': (node.data as GroupNodeData).color ?? '#A594E0',
    } as CSSProperties;
  }
  return base;
};

export const sanitizeReferenceSourcePatch = (patch: Partial<CanvasNode>): Partial<CanvasNode> => {
  const { x: _x, y: _y, width: _width, height: _height, ref: _ref, ...rest } = patch;
  return rest;
};
