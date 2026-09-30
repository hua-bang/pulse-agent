import { lazy, Suspense } from 'react';
import type { PluginNodeViewProps, RendererCanvasPlugin } from '../../types';
import { MCP_APP_NODE_PLUGIN_ID, MCP_APP_NODE_TYPE } from '../../../shared/mcp-app-node';
import './index.css';

const McpAppNodeView = lazy(() =>
  import('./McpAppNodeView').then((module) => ({ default: module.McpAppNodeView })),
);

const LazyMcpAppNodeView = (props: PluginNodeViewProps) => (
  <Suspense fallback={<div className="mcp-app-node mcp-app-node--status" />}>
    <McpAppNodeView {...props} />
  </Suspense>
);

export const McpAppNodeRendererPlugin: RendererCanvasPlugin = {
  id: MCP_APP_NODE_PLUGIN_ID,
  activate(ctx) {
    ctx.registerNodeView(MCP_APP_NODE_TYPE, LazyMcpAppNodeView);
  },
};
