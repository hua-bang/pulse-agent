import { describe, expect, it } from 'vitest';
import { MCP_APP_VIEW, mcpAppRoutePath, resolveAppRoute } from './routeModel';

describe('app route model', () => {
  it('redirects stale disabled node deep links to the canvas', () => {
    expect(resolveAppRoute('/nodes/ws-1/node-1', {
      nodesEnabled: false,
      graphEnabled: false,
      pluginPaths: [],
    })).toMatchObject({
      activeView: 'canvas',
      redirectToCanvas: true,
      detailNode: { workspaceId: 'ws-1', nodeId: 'node-1' },
    });
  });

  it('preserves scheduled detail and registered plugin route identities', () => {
    expect(resolveAppRoute('/scheduled/task-1', {
      nodesEnabled: true,
      graphEnabled: true,
      pluginPaths: ['/custom'],
    })).toMatchObject({ activeView: 'scheduled-task', scheduledTaskId: 'task-1' });
    expect(resolveAppRoute('/custom', {
      nodesEnabled: true,
      graphEnabled: true,
      pluginPaths: ['/custom'],
    }).activeView).toBe('/custom');
  });

  it('maps the settings page and launcher routes, keeping the settings section', () => {
    const options = { nodesEnabled: false, graphEnabled: false, pluginPaths: [] };
    const settings = resolveAppRoute('/settings?section=plugins', options);
    expect(settings.activeView).toBe('settings');
    expect(settings.params.get('section')).toBe('plugins');
    expect(resolveAppRoute('/home', options).activeView).toBe('home');
  });

  it('reads the settings section from the browser search used by hash navigation', () => {
    const options = { nodesEnabled: false, graphEnabled: false, pluginPaths: [] };
    expect(resolveAppRoute('/settings', options, '?section=agent').params.get('section')).toBe('agent');
    expect(resolveAppRoute('/settings?section=models', options, '?section=agent').params.get('section')).toBe('models');
    expect(resolveAppRoute('/home', options, '?section=agent').params.has('section')).toBe(false);
  });

  it('round-trips global MCP App routes with encoded server and tool names', () => {
    const target = { serverName: 'mock apps/v2', toolName: 'parts.library' };
    const path = mcpAppRoutePath(target);
    expect(path).toBe('/apps/mock%20apps%2Fv2/parts.library');
    expect(resolveAppRoute(path, {
      nodesEnabled: false,
      graphEnabled: false,
      pluginPaths: [],
    })).toMatchObject({ activeView: MCP_APP_VIEW, mcpApp: target, redirectToCanvas: false });
    expect(resolveAppRoute('/apps', {
      nodesEnabled: false,
      graphEnabled: false,
      pluginPaths: [],
    })).toMatchObject({ activeView: 'canvas', mcpApp: null });
  });
});
