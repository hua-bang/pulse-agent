import { describe, expect, it, vi } from 'vitest';
import type { MainCtx, PluginNodeCapabilities } from '../../types';
import { McpAppNodeMainPlugin } from '.';

function activate(): PluginNodeCapabilities {
  const registerNodeCapabilities = vi.fn();
  void McpAppNodeMainPlugin.activate({ registerNodeCapabilities } as unknown as MainCtx);
  expect(registerNodeCapabilities).toHaveBeenCalledWith('mcp-app', expect.any(Object));
  return registerNodeCapabilities.mock.calls[0][1];
}

const nodeWith = (payload: unknown) => ({
  workspaceId: 'ws-1',
  node: { id: 'n1', type: 'plugin', data: { pluginId: 'mcp-apps', nodeType: 'mcp-app', payload } },
}) as never;

describe('MCP App node capabilities', () => {
  it('reads the binding and points the Agent at the server tools', async () => {
    const capabilities = activate();
    const result = await capabilities.read!(nodeWith({
      serverName: 'bits.bits-and-bolts',
      toolName: 'cad.library',
      resourceUri: 'ui://bits-and-bolts/app',
      title: 'Bits & Bolts',
      kind: 'global',
    })) as { content: string; binding: unknown };

    expect(result.content).toContain('mcp_bits_bits-and-bolts_*');
    expect(result.binding).toMatchObject({ serverName: 'bits.bits-and-bolts', kind: 'global' });
    expect(result.content).toContain('current visible-ui/model-context first');
    expect(result.content).toContain('The entrypoint "cad.library" opens an App');
    expect(result.content).toContain('do not call it merely to read or summarize this existing node');
    expect(capabilities.write).toBeUndefined();
    expect(capabilities.actions).toBeUndefined();
  });

  it('reports an invalid binding instead of throwing', async () => {
    const result = await activate().read!(nodeWith({})) as { content: string };
    expect(result.content).toContain('invalid binding');
  });
});
