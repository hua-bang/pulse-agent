import type { KnowledgeNodeSelection } from '../../types';
import { parseCanvasLocation } from '../canvasLinks';

export const APP_ROUTES = {
  canvas: '/',
  chat: '/chat',
  nodes: '/nodes',
  graph: '/graph',
  plugins: '/plugins',
  skills: '/skills',
  scheduled: '/scheduled',
  apps: '/apps',
  settings: '/settings',
  home: '/home',
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

/** Routes that map one exact path to one view. */
const STATIC_VIEWS: Record<string, AppActiveView> = {
  [APP_ROUTES.chat]: 'chat',
  [APP_ROUTES.settings]: 'settings',
  [APP_ROUTES.home]: 'home',
  [APP_ROUTES.plugins]: 'plugins',
  [APP_ROUTES.skills]: 'skills',
  [APP_ROUTES.scheduled]: 'scheduled',
};

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
  search = '',
): AppRouteModel => {
  const { path, params } = parseCanvasLocation(location);
  // Wouter hash navigation places ?section in the browser search, while
  // manually opened links can still carry it inside the hash.
  if (path === APP_ROUTES.settings && !params.has('section')) {
    const section = new URLSearchParams(search).get('section');
    if (section) params.set('section', section);
  }
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
  const activeView: AppActiveView = STATIC_VIEWS[path]
    ?? (scheduledMatch
      ? 'scheduled-task'
      : mcpApp
        ? MCP_APP_VIEW
        : nodesRoute
          ? detailNode ? 'node-detail' : 'nodes'
          : graphRoute
            ? 'graph'
            : options.pluginPaths.includes(path)
              ? path
              : 'canvas');
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
