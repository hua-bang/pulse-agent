import type { RendererCanvasPlugin } from '../types';
import { DevtoolsRendererPlugin } from './devtools';

// Renderer-side halves of built-in Canvas plugins.
// The Perf panel is intentionally NOT listed here: it is activated via a
// __PERF_TOOLS__-gated dynamic import in main.tsx so production builds strip
// it from the bundle entirely.
export const BUILT_IN_RENDERER_PLUGINS: RendererCanvasPlugin[] = [
  DevtoolsRendererPlugin,
];
