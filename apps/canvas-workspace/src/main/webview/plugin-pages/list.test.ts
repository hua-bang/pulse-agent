import { describe, expect, it, vi } from 'vitest';

vi.mock('../registry', () => ({
  listRegisteredWebviews: () => [
    {
      workspaceId: '__plugin-pages__',
      nodeId: 'plugin:weread/main',
      webContentsId: 1,
      wc: { getTitle: () => 'Reading', getURL: () => 'https://weread.test/' },
    },
    {
      workspaceId: 'ws-1',
      nodeId: 'node-1',
      webContentsId: 2,
      wc: { getTitle: () => 'Canvas page', getURL: () => 'https://example.test/' },
    },
  ],
}));

import { listOpenPluginPages } from './list';

describe('listOpenPluginPages', () => {
  it('lists only registered plugin pages', () => {
    expect(listOpenPluginPages()).toEqual([{
      nodeId: 'plugin:weread/main',
      pluginId: 'weread',
      viewId: 'main',
      title: 'Reading',
      url: 'https://weread.test/',
    }]);
  });
});
