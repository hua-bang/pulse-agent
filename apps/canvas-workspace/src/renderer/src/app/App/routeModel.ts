import type { KnowledgeNodeSelection } from '../../types';
import { parseCanvasLocation } from '../../utils/canvasLinks';

export const APP_ROUTES = {
  canvas: '/',
  chat: '/chat',
  nodes: '/nodes',
  graph: '/graph',
  plugins: '/plugins',
  skills: '/skills',
  scheduled: '/scheduled',
  apps: '/apps',
} as const;

/** Main-area view key for a global MCP App (`/apps/<server>/<tool>`). */
export const MCP_APP_VIEW = 'mcp-app';

export interface McpAppRouteTarget {
  serverName: string;
  toolName: string;
}

export const mcpAppRoutePath = ({ serverName, toolName }: McpAppRouteTarget): string => (
  `${APP_ROUTES.apps}/${encodeURIComponent(serverName)}/${encodeURIComponent(toolName)}`
);

export type AppActiveView = 'canvas' | 'chat' | string;

interface ResolveAppRouteOptions {
  nodesEnabled: boolean;
  graphEnabled: boolean;
  pluginPaths: string[];
}

export interface AppRouteModel {
  path: string;
  params: URLSearchParams;
  query: string;
  activeView: AppActiveView;
  detailNode: KnowledgeNodeSelection | null;
  scheduledTaskId: string | null;
  mcpApp: McpAppRouteTarget | null;
  redirectToCanvas: boolean;
}

export const resolveAppRoute = (
  location: string,
  options: ResolveAppRouteOptions,
): AppRouteModel => {
  const { path, params } = parseCanvasLocation(location);
  const detailMatch = path.match(/^\/nodes\/([^/]+)\/([^/]+)$/);
  const scheduledMatch = path.match(/^\/scheduled\/([^/]+)$/);
  const mcpAppMatch = path.match(/^\/apps\/([^/]+)\/([^/]+)$/);
  const mcpApp = mcpAppMatch
    ? { serverName: decodeURIComponent(mcpAppMatch[1]), toolName: decodeURIComponent(mcpAppMatch[2]) }
    : null;
  const detailNode = detailMatch
    ? {
        workspaceId: decodeURIComponent(detailMatch[1]),
        nodeId: decodeURIComponent(detailMatch[2]),
      }
    : null;
  const nodesRoute = options.nodesEnabled && (path === APP_ROUTES.nodes || detailNode !== null);
  const graphRoute = options.graphEnabled && path === APP_ROUTES.graph;
  const activeView: AppActiveView = path === APP_ROUTES.chat
    ? 'chat'
    : path === APP_ROUTES.plugins
      ? 'plugins'
      : path === APP_ROUTES.skills
        ? 'skills'
        : scheduledMatch
          ? 'scheduled-task'
          : mcpApp
            ? MCP_APP_VIEW
            : path === APP_ROUTES.scheduled
              ? 'scheduled'
              : nodesRoute
                ? detailNode ? 'node-detail' : 'nodes'
                : graphRoute
                  ? 'graph'
                  : options.pluginPaths.includes(path)
                    ? path
                    : 'canvas';
  return {
    path,
    params,
    query: params.toString(),
    activeView,
    detailNode,
    scheduledTaskId: scheduledMatch ? decodeURIComponent(scheduledMatch[1]) : null,
    mcpApp,
    redirectToCanvas: (!options.nodesEnabled && (path === APP_ROUTES.nodes || detailNode !== null))
      || (!options.graphEnabled && path === APP_ROUTES.graph),
  };
};
