import { describe, expect, it } from 'vitest';
import { mcpAppNodeBindingFromListing, parseMcpAppNodeBinding } from './mcp-app-node';

describe('MCP App node binding', () => {
  it('round-trips a listing into a persisted binding', () => {
    const binding = mcpAppNodeBindingFromListing({
      serverName: 'acme',
      toolName: 'board',
      resourceUri: 'ui://acme/board',
      title: 'Board',
      kind: 'node',
      nodeType: 'acme.board',
      defaultSize: { width: 600, height: 400 },
    });

    expect(binding).toEqual({
      serverName: 'acme',
      toolName: 'board',
      resourceUri: 'ui://acme/board',
      title: 'Board',
      kind: 'node',
      entryNodeType: 'acme.board',
    });
    expect(parseMcpAppNodeBinding(JSON.parse(JSON.stringify(binding)))).toEqual(binding);
  });

  it('rejects payloads that cannot be reopened and defaults optional fields', () => {
    expect(parseMcpAppNodeBinding(undefined)).toBeUndefined();
    expect(parseMcpAppNodeBinding({ serverName: 'a', toolName: 'b', resourceUri: 'https://x' })).toBeUndefined();
    expect(parseMcpAppNodeBinding({ serverName: 'a', toolName: 'b', resourceUri: 'ui://a', kind: 'file' }))
      .toEqual({ serverName: 'a', toolName: 'b', resourceUri: 'ui://a', title: 'b', kind: 'global' });
  });
});
