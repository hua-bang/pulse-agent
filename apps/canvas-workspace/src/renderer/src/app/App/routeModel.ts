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
} as const;

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
  redirectToCanvas: boolean;
}

export const resolveAppRoute = (
  location: string,
  options: ResolveAppRouteOptions,
): AppRouteModel => {
  const { path, params } = parseCanvasLocation(location);
  const detailMatch = path.match(/^\/nodes\/([^/]+)\/([^/]+)$/);
  const scheduledMatch = path.match(/^\/scheduled\/([^/]+)$/);
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
    redirectToCanvas: (!options.nodesEnabled && (path === APP_ROUTES.nodes || detailNode !== null))
      || (!options.graphEnabled && path === APP_ROUTES.graph),
  };
};
