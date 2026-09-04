import { describe, expect, it } from 'vitest';
import { resolveAppRoute } from './routeModel';

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
});
