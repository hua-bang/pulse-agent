import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { readPluginPackage } from './package-reader';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const examples = [
  ['mcp-apps-basic-react', '@modelcontextprotocol/server-basic-react@1.7.5'],
  ['mcp-apps-map', '@modelcontextprotocol/server-map@1.7.5'],
  ['mcp-apps-threejs', '@modelcontextprotocol/server-threejs@1.7.5'],
] as const;

describe('MCP Apps Agent Plugin examples', () => {
  it.each(examples)('keeps %s strict and runtime-pinned', async (name, npmPackage) => {
    const result = await readPluginPackage(resolve(repoRoot, 'examples/agent-plugins', name));
    expect(result.diagnostics).toEqual([]);
    expect(result.package).toMatchObject({
      format: 'agent-plugin',
      name,
      skills: [],
      mcp: { servers: [{ type: 'stdio', command: 'npx' }] },
    });
    const server = result.package?.mcp?.servers[0];
    expect(server?.type).toBe('stdio');
    if (server?.type === 'stdio') expect(server.args).toContain(npmPackage);
  });
});
