import { describe, expect, it } from 'vitest';
import {
  PLUGIN_PAGE_WORKSPACE_ID,
  isConsistentWebviewRegistration,
  parsePluginPageTargetId,
  pluginPageTargetId,
  webviewRegistryKeyFor,
} from './webview-registration';

describe('plugin page targets', () => {
  it('round-trips valid ids and rejects anything else', () => {
    const id = pluginPageTargetId({ pluginId: 'weread', viewId: 'reader' });
    expect(id).toBe('plugin:weread/reader');
    expect(parsePluginPageTargetId(id)).toEqual({ pluginId: 'weread', viewId: 'reader' });
    for (const bad of ['plugin:weread', 'plugin:WeRead/main', 'plugin:a/b/c', 'link:abc', 'node-1', 'plugin:/main']) {
      expect(parsePluginPageTargetId(bad)).toBeNull();
    }
  });

  it('maps plugin targets to the reserved workspace from any caller workspace', () => {
    expect(webviewRegistryKeyFor('ws-1', 'plugin:weread/main')).toEqual({
      workspaceId: PLUGIN_PAGE_WORKSPACE_ID,
      nodeId: 'plugin:weread/main',
      isPluginPage: true,
    });
    expect(webviewRegistryKeyFor('ws-1', 'node-1')).toEqual({
      workspaceId: 'ws-1',
      nodeId: 'node-1',
      isPluginPage: false,
    });
  });

  it('accepts plugin pages only in the reserved workspace', () => {
    const plugin = { workspaceId: PLUGIN_PAGE_WORKSPACE_ID, nodeId: 'plugin:weread/main' };
    expect(isConsistentWebviewRegistration({ ...plugin, surfaceKind: 'plugin-page' })).toBe(true);
    expect(isConsistentWebviewRegistration(plugin)).toBe(false);
    expect(isConsistentWebviewRegistration({ ...plugin, surfaceKind: 'dock-browser' })).toBe(false);
    expect(isConsistentWebviewRegistration({ workspaceId: 'ws-1', nodeId: 'n', surfaceKind: 'plugin-page' }))
      .toBe(false);
    expect(isConsistentWebviewRegistration({ workspaceId: 'ws-1', nodeId: 'n' })).toBe(true);
    expect(isConsistentWebviewRegistration({
      workspaceId: 'ws-1', nodeId: 'n', surfaceKind: 'nope' as never,
    })).toBe(false);
  });
});
