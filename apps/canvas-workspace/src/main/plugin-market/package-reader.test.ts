import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AGENT_PLUGIN_MCP_V1_SCHEMA,
  AGENT_PLUGIN_V1_SCHEMA,
  PULSE_CANVAS_EXTENSION_NAMESPACE,
} from '../../shared/plugin-market';
import { readPluginPackage } from './package-reader';

const roots: string[] = [];

async function createRoot(prefix = 'pulse-plugin-reader-'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8');
}

async function writeSkill(
  root: string,
  directoryName: string,
  name = directoryName,
  description = `Use ${name}`,
): Promise<string> {
  const skillPath = join(root, 'skills', directoryName, 'SKILL.md');
  await mkdir(dirname(skillPath), { recursive: true });
  await writeFile(
    skillPath,
    `---\nname: ${name}\ndescription: ${description}\n---\n\nInstructions.\n`,
    'utf8',
  );
  return skillPath;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('readPluginPackage', () => {
  it('accepts the minimal Agent Plugins v1 manifest', async () => {
    const root = await createRoot();
    await writeJson(join(root, 'plugin.json'), {
      $schema: AGENT_PLUGIN_V1_SCHEMA,
      name: 'minimal-plugin',
    });

    const result = await readPluginPackage(root);
    const canonicalRoot = await realpath(root);

    expect(result.diagnostics).toEqual([]);
    expect(result.package).toEqual({
      format: 'agent-plugin',
      root: canonicalRoot,
      manifestPath: join(canonicalRoot, 'plugin.json'),
      name: 'minimal-plugin',
      keywords: [],
      skills: [],
    });
  });

  it('discovers only valid immediate-child skills and reports invalid ones', async () => {
    const root = await createRoot();
    await writeJson(join(root, 'plugin.json'), {
      $schema: AGENT_PLUGIN_V1_SCHEMA,
      name: 'skills-plugin',
    });
    await writeSkill(root, 'deploy');
    await writeSkill(root, 'mismatch', 'other-name');
    await writeSkill(root, 'nested/deep');

    const result = await readPluginPackage(root);
    const canonicalRoot = await realpath(root);

    expect(result.package?.skills).toEqual([
      {
        name: 'deploy',
        description: 'Use deploy',
        directory: join(canonicalRoot, 'skills', 'deploy'),
        skillPath: join(canonicalRoot, 'skills', 'deploy', 'SKILL.md'),
      },
    ]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'error',
        scope: 'skill',
        code: 'skill.invalid',
        componentId: 'mismatch',
      }),
    ]);
  });

  it('loads valid MCP servers while isolating invalid server entries', async () => {
    const root = await createRoot();
    await writeJson(join(root, 'plugin.json'), {
      $schema: AGENT_PLUGIN_V1_SCHEMA,
      name: 'mcp-plugin',
    });
    await mkdir(join(root, 'bin'), { recursive: true });
    await mkdir(join(root, 'data'), { recursive: true });
    await writeFile(join(root, 'bin', 'server'), '#!/bin/sh\n', 'utf8');
    await writeJson(join(root, 'mcp.json'), {
      $schema: AGENT_PLUGIN_MCP_V1_SCHEMA,
      mcpServers: {
        local: {
          type: 'stdio',
          command: './bin/server',
          args: ['--serve'],
          cwd: './data',
        },
        remote: {
          type: 'streamable-http',
          url: 'https://example.com/mcp',
        },
        publicHeaders: {
          type: 'streamable-http',
          url: 'https://example.com/mcp',
          headers: { 'X-Client': 'pulse' },
        },
        embeddedCredential: {
          type: 'streamable-http',
          url: 'https://example.com/mcp',
          headers: { Authorization: 'Bearer secret' },
        },
        insecure: {
          type: 'streamable-http',
          url: 'http://example.com/mcp',
        },
        emptyFragment: {
          type: 'streamable-http',
          url: 'https://example.com/mcp#',
        },
      },
    });

    const result = await readPluginPackage(root);
    const canonicalRoot = await realpath(root);

    expect(result.package?.mcp).toEqual({
      path: join(canonicalRoot, 'mcp.json'),
      servers: [
        {
          name: 'local',
          type: 'stdio',
          command: './bin/server',
          resolvedCommand: join(canonicalRoot, 'bin', 'server'),
          args: ['--serve'],
          cwd: './data',
          resolvedCwd: join(canonicalRoot, 'data'),
        },
        {
          name: 'remote',
          type: 'streamable-http',
          url: 'https://example.com/mcp',
        },
        {
          name: 'publicHeaders',
          type: 'streamable-http',
          url: 'https://example.com/mcp',
          headers: { 'X-Client': 'pulse' },
        },
      ],
    });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'error',
        scope: 'mcp-server',
        code: 'mcp-server.invalid',
        componentId: 'embeddedCredential',
      }),
      expect.objectContaining({
        severity: 'error',
        scope: 'mcp-server',
        code: 'mcp-server.invalid',
        componentId: 'insecure',
      }),
      expect.objectContaining({
        severity: 'error',
        scope: 'mcp-server',
        code: 'mcp-server.invalid',
        componentId: 'emptyFragment',
      }),
    ]);
  });

  it('normalizes the Pulse client extension without enabling it', async () => {
    const root = await createRoot();
    const extensionData = {
      schemaVersion: 1,
      main: {
        entry: './dist/main.js',
        format: 'esm',
        runtime: 'electron-main',
        permissions: ['canvas'],
      },
      config: [{ key: 'apiToken', type: 'password', envKeys: ['DEMO_TOKEN'] }],
      nodes: [
        {
          type: 'demo.card',
          title: 'Demo Card',
          renderer: {
            remoteName: 'demo_remote',
            entry: 'renderer/remoteEntry.js',
            expose: './plugin',
          },
        },
      ],
    };
    await writeJson(join(root, 'plugin.json'), {
      $schema: AGENT_PLUGIN_V1_SCHEMA,
      name: 'pulse-extension',
      extensions: { [PULSE_CANVAS_EXTENSION_NAMESPACE]: extensionData },
    });
    await mkdir(join(root, PULSE_CANVAS_EXTENSION_NAMESPACE), { recursive: true });
    await mkdir(join(root, 'dist'), { recursive: true });
    await mkdir(join(root, 'renderer'), { recursive: true });
    await writeFile(join(root, 'dist', 'main.js'), 'export default {}', 'utf8');
    await writeFile(join(root, 'renderer', 'remoteEntry.js'), 'export default {}', 'utf8');

    const result = await readPluginPackage(root);
    const canonicalRoot = await realpath(root);

    expect(result.diagnostics).toEqual([]);
    expect(result.package?.pulseExtension).toEqual({
      namespace: PULSE_CANVAS_EXTENSION_NAMESPACE,
      source: 'plugin-extension',
      directory: join(canonicalRoot, PULSE_CANVAS_EXTENSION_NAMESPACE),
      data: extensionData,
      schemaVersion: 1,
      main: {
        entry: join(canonicalRoot, 'dist', 'main.js'),
        format: 'esm',
        runtime: 'electron-main',
        permissions: ['canvas'],
      },
      nodes: [
        {
          type: 'demo.card',
          title: 'Demo Card',
          renderer: {
            remoteName: 'demo_remote',
            entry: join(canonicalRoot, 'renderer', 'remoteEntry.js'),
            expose: './plugin',
          },
        },
      ],
      config: [{ key: 'apiToken', type: 'password', envKeys: ['DEMO_TOKEN'] }],
    });
  });

  it('falls back to a legacy Canvas manifest only when plugin.json is absent', async () => {
    const root = await createRoot();
    const legacyManifest = {
      id: 'legacy-demo',
      version: '0.4.0',
      main: { entry: 'dist/main.js', format: 'esm' },
      skills: [{
        name: 'legacy-renamed',
        description: 'Legacy manifest metadata wins',
        path: 'skills/legacy-skill',
      }],
      config: [{ key: 'token', type: 'password' }],
      nodes: [
        {
          type: 'legacy.card',
          renderer: { remoteName: 'legacy_remote', entry: 'renderer/remoteEntry.js' },
        },
      ],
    };
    await writeJson(join(root, 'manifest.json'), legacyManifest);
    await writeSkill(root, 'legacy-skill');
    await mkdir(join(root, 'dist'), { recursive: true });
    await mkdir(join(root, 'renderer'), { recursive: true });
    await writeFile(join(root, 'dist', 'main.js'), 'export default {}', 'utf8');
    await writeFile(join(root, 'renderer', 'remoteEntry.js'), 'export default {}', 'utf8');

    const result = await readPluginPackage(root);
    const canonicalRoot = await realpath(root);

    expect(result.diagnostics).toEqual([]);
    expect(result.package).toMatchObject({
      format: 'legacy-canvas',
      root: canonicalRoot,
      manifestPath: join(canonicalRoot, 'manifest.json'),
      name: 'legacy-demo',
      version: '0.4.0',
      keywords: [],
      skills: [
        {
          name: 'legacy-renamed',
          description: 'Legacy manifest metadata wins',
          directory: join(canonicalRoot, 'skills', 'legacy-skill'),
          skillPath: join(canonicalRoot, 'skills', 'legacy-skill', 'SKILL.md'),
        },
      ],
      pulseExtension: {
        namespace: PULSE_CANVAS_EXTENSION_NAMESPACE,
        source: 'legacy-manifest',
        data: legacyManifest,
        main: { entry: join(canonicalRoot, 'dist', 'main.js'), format: 'esm' },
        nodes: [
          {
            type: 'legacy.card',
            renderer: {
              remoteName: 'legacy_remote',
              entry: join(canonicalRoot, 'renderer', 'remoteEntry.js'),
            },
          },
        ],
        config: [{ key: 'token', type: 'password' }],
      },
    });
  });

  it('rejects an invalid core manifest without merging a valid legacy manifest', async () => {
    const root = await createRoot();
    await writeJson(join(root, 'plugin.json'), {
      $schema: AGENT_PLUGIN_V1_SCHEMA,
      name: 'Invalid-Name',
    });
    await writeJson(join(root, 'manifest.json'), { id: 'legacy-must-not-load' });

    const result = await readPluginPackage(root);

    expect(result.package).toBeNull();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'error',
        scope: 'manifest',
        code: 'manifest.invalid',
      }),
    ]);
  });

  it('rejects plugin.json that resolves outside the package and never falls back', async () => {
    const root = await createRoot();
    const outside = await createRoot('pulse-plugin-outside-');
    await writeJson(join(outside, 'plugin.json'), {
      $schema: AGENT_PLUGIN_V1_SCHEMA,
      name: 'outside-plugin',
    });
    await symlink(join(outside, 'plugin.json'), join(root, 'plugin.json'));
    await writeJson(join(root, 'manifest.json'), { id: 'legacy-must-not-load' });

    const result = await readPluginPackage(root);

    expect(result.package).toBeNull();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'error',
        scope: 'manifest',
        code: 'manifest.unreadable',
      }),
    ]);
  });

  it('isolates component paths that escape through symlinks or absolute extension paths', async () => {
    const root = await createRoot();
    const outside = await createRoot('pulse-plugin-outside-');
    await writeSkill(outside, 'escape');
    await writeFile(join(outside, 'server'), '#!/bin/sh\n', 'utf8');
    await symlink(join(outside, 'skills'), join(root, 'skills'), 'dir');
    await mkdir(join(root, 'bin'), { recursive: true });
    await symlink(join(outside, 'server'), join(root, 'bin', 'server'));
    await writeJson(join(root, 'plugin.json'), {
      $schema: AGENT_PLUGIN_V1_SCHEMA,
      name: 'contained-plugin',
      extensions: {
        [PULSE_CANVAS_EXTENSION_NAMESPACE]: {
          main: { entry: join(outside, 'server') },
        },
      },
    });
    await writeJson(join(root, 'mcp.json'), {
      $schema: AGENT_PLUGIN_MCP_V1_SCHEMA,
      mcpServers: {
        escaped: { type: 'stdio', command: './bin/server' },
      },
    });

    const result = await readPluginPackage(root);

    expect(result.package).not.toBeNull();
    expect(result.package?.skills).toEqual([]);
    expect(result.package?.mcp?.servers).toEqual([]);
    expect(result.package?.pulseExtension).toBeUndefined();
    expect(result.diagnostics.map(({ scope, code }) => ({ scope, code }))).toEqual([
      { scope: 'skills', code: 'skills.invalid-location' },
      { scope: 'mcp-server', code: 'mcp-server.invalid' },
      { scope: 'pulse-extension', code: 'pulse-extension.invalid' },
    ]);
  });

  it('reports and ignores the two non-fatal v1 manifest exceptions', async () => {
    const root = await createRoot();
    await writeJson(join(root, 'plugin.json'), {
      $schema: AGENT_PLUGIN_V1_SCHEMA,
      name: 'forward-compatible',
      author: { name: 'Pulse' },
      futureField: true,
      extensions: 'temporarily-invalid',
    });

    const result = await readPluginPackage(root);

    expect(result.package?.name).toBe('forward-compatible');
    expect(result.package?.pulseExtension).toBeUndefined();
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(result.diagnostics.map(({ severity, code }) => ({ severity, code }))).toEqual([
      { severity: 'warning', code: 'manifest.unknown-field' },
      { severity: 'warning', code: 'manifest.invalid-extensions' },
    ]);
  });

  it('keeps valid skills when the MCP component is malformed', async () => {
    const root = await createRoot();
    await writeJson(join(root, 'plugin.json'), {
      $schema: AGENT_PLUGIN_V1_SCHEMA,
      name: 'partial-plugin',
    });
    await writeSkill(root, 'usable');
    await writeFile(join(root, 'mcp.json'), '{not json', 'utf8');

    const result = await readPluginPackage(root);

    expect(result.package?.skills.map((skill) => skill.name)).toEqual(['usable']);
    expect(result.package?.mcp).toBeUndefined();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ severity: 'error', scope: 'mcp', code: 'mcp.unreadable' }),
    ]);
  });
});
