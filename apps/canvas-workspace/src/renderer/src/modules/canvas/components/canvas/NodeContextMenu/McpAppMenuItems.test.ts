import { describe, expect, it } from 'vitest';
import { mcpAppNodeOptions } from './McpAppMenuItems';

describe('mcpAppNodeOptions', () => {
  it('creates a plugin node bound to the entrypoint with its declared size', () => {
    expect(mcpAppNodeOptions({
      serverName: 'cad',
      toolName: 'cad.library',
      resourceUri: 'ui://cad/app',
      title: 'Bits & Bolts',
      kind: 'global',
    })).toEqual({
      label: 'Bits & Bolts',
      nodePatch: {
        title: 'Bits & Bolts',
        width: 720,
        height: 520,
        data: {
          pluginId: 'mcp-apps',
          nodeType: 'mcp-app',
          payload: {
            serverName: 'cad',
            toolName: 'cad.library',
            resourceUri: 'ui://cad/app',
            title: 'Bits & Bolts',
            kind: 'global',
          },
        },
      },
    });
  });
});
