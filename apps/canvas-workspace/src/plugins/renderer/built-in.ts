import type { RendererCanvasPlugin } from '../types';
import { DevtoolsRendererPlugin } from './devtools';
import { MemoryRendererPlugin } from './memory';

// Renderer-side halves of built-in Canvas plugins.
export const BUILT_IN_RENDERER_PLUGINS: RendererCanvasPlugin[] = [
  DevtoolsRendererPlugin,
  MemoryRendererPlugin,
];
