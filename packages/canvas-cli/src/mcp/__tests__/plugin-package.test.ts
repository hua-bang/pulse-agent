import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs, constants as fsConstants } from 'fs';
import { join, relative } from 'path';
import { tmpdir } from 'os';
import { installSkills } from '../../commands/install-skills';
import { MCP_PLUGIN_API_VERSION } from '../server';

/**
 * Guards for the `plugins/pulse-canvas` agent plugin, whose MCP server and
 * skills come from this package.
 */
const pluginRoot = join(__dirname, '..', '..', '..', '..', '..', 'plugins', 'pulse-canvas');
const readJson = async (path: string) => JSON.parse(await fs.readFile(join(pluginRoot, path), 'utf-8'));

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(path));
    else out.push(path);
  }
  return out;
}

let scratch: string | undefined;

afterEach(async () => {
  if (scratch) await fs.rm(scratch, { recursive: true, force: true });
  scratch = undefined;
});

describe('pulse-canvas agent plugin package', () => {
  it('has a valid Agent Plugins manifest and stdio MCP config', async () => {
    const manifest = await readJson('plugin.json');
    expect(manifest.$schema).toBe('https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
    expect(manifest.name).toMatch(/^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);
    const icon = manifest.extensions['com.openai'].interface.composerIcon as string;
    await expect(fs.access(join(pluginRoot, icon))).resolves.toBeUndefined();

    const mcp = await readJson('mcp.json');
    expect(mcp.$schema).toBe('https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
    const server = mcp.mcpServers['pulse-canvas'];
    expect(server).toMatchObject({ type: 'stdio', cwd: '${PLUGIN_ROOT}' });
    expect(server.command).toMatch(/^\.\//);
    await expect(fs.access(join(pluginRoot, server.command), fsConstants.X_OK)).resolves.toBeUndefined();
  });

  it('launches with the plugin API this server implements', async () => {
    const launcher = await fs.readFile(join(pluginRoot, 'bin', 'pulse-canvas-mcp'), 'utf-8');
    expect(launcher).toContain(`PLUGIN_API=${MCP_PLUGIN_API_VERSION}\n`);
    expect(launcher).toContain('exec "$bin" mcp --plugin-api "$PLUGIN_API"');
  });

  it('ships exactly the skills install-skills produces (run sync:plugin-skills after editing skills/)', async () => {
    scratch = join(tmpdir(), `canvas-cli-plugin-skills-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    const result = await installSkills(scratch);
    expect(result.ok).toBe(true);

    const expectedDir = scratch;
    const actualDir = join(pluginRoot, 'skills');
    const expected = (await listFiles(expectedDir)).map(path => relative(expectedDir, path)).sort();
    const actual = (await listFiles(actualDir)).map(path => relative(actualDir, path)).sort();
    expect(actual).toEqual(expected);
    for (const path of expected) {
      const [want, have] = await Promise.all([
        fs.readFile(join(expectedDir, path), 'utf-8'),
        fs.readFile(join(actualDir, path), 'utf-8'),
      ]);
      expect(have, `plugins/pulse-canvas/skills/${path} is stale`).toBe(want);
    }
  });
});
