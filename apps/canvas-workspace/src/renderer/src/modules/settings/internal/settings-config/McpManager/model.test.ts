import { describe, expect, it } from 'vitest';
import { createEmptyMcpDraft, mcpDraftForServer, mcpServerFromDraft, setMcpDraftTransport } from './model';

describe('MCP server draft model', () => {
  it('round-trips HTTP OAuth fields while omitting blank secrets', () => {
    const draft = mcpDraftForServer({
      name: 'research', transport: 'http', url: 'https://mcp.example.com',
      headers: { Authorization: 'Bearer token' }, auth: 'oauth',
      oauth: { clientId: 'client', scope: 'read write' }, deferTools: true,
    });
    expect(mcpServerFromDraft(draft)).toEqual({
      name: 'research', transport: 'http', url: 'https://mcp.example.com',
      headers: { Authorization: 'Bearer token' }, auth: 'oauth',
      oauth: { clientId: 'client', scope: 'read write' }, deferTools: true,
    });
  });

  it('parses stdio args/env and clears HTTP-only auth when transport changes', () => {
    const draft = {
      ...createEmptyMcpDraft(), name: 'local', command: 'node',
      argsText: 'server.js\n--stdio', envText: 'TOKEN=secret\nEMPTY=',
    };
    const stdio = setMcpDraftTransport(draft, 'stdio');
    expect(stdio.auth).toBe('none');
    expect(mcpServerFromDraft(stdio)).toEqual({
      name: 'local', transport: 'stdio', command: 'node',
      args: ['server.js', '--stdio'], env: { TOKEN: 'secret', EMPTY: '' },
      deferTools: false,
    });
  });
});
