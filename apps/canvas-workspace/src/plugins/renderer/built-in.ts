import type { RendererCanvasPlugin } from '../types';
import { DevtoolsRendererPlugin } from './devtools';
import { MockNodeRendererPlugin } from './mock-node';
import { McpAppNodeRendererPlugin } from './mcp-app-node';

// Renderer-side halves of built-in Canvas plugins.
export const BUILT_IN_RENDERER_PLUGINS: RendererCanvasPlugin[] = [
  DevtoolsRendererPlugin,
  MockNodeRendererPlugin,
  McpAppNodeRendererPlugin,
];
