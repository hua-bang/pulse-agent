import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as store from '../config/workspace-config-store';

// Redirect the store root via PULSE_CANVAS_CONFIG_ROOT so writes land in
// a temp directory and tests don't touch the developer's real ~/.pulse-coder.
let tempHome: string;
let realRoot: string | undefined;
beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'pulse-canvas-config-'));
  realRoot = process.env.PULSE_CANVAS_CONFIG_ROOT;
  process.env.PULSE_CANVAS_CONFIG_ROOT = tempHome;
});

afterEach(async () => {
  if (realRoot === undefined) delete process.env.PULSE_CANVAS_CONFIG_ROOT;
  else process.env.PULSE_CANVAS_CONFIG_ROOT = realRoot;
  await fs.rm(tempHome, { recursive: true, force: true });
});

describe('workspace-config-store', () => {
  it('returns empty config when no files exist', async () => {
    const cfg = await store.readMergedConfig('ws1');
    expect(cfg.mcpServers).toEqual({});
    expect(cfg.skills).toEqual([]);
    expect(cfg.configHash).toBeTypeOf('string');
  });

  it('merges global + workspace MCP, workspace wins on collision', async () => {
    await store.saveMCPConfig(
      { kind: 'global' },
      {
        mcpServers: {
          alpha: { command: 'npx', args: ['-y', '@a/global'], transport: 'stdio' },
          shared: { command: 'global-shared', transport: 'stdio' },
        },
      },
    );
    await store.saveMCPConfig(
      { kind: 'workspace', workspaceId: 'ws1' },
      {
        mcpServers: {
          beta: { command: 'workspace-beta', transport: 'stdio' },
          shared: { command: 'workspace-shared', transport: 'stdio' },
        },
      },
    );
    const merged = await store.readMergedConfig('ws1');
    expect(Object.keys(merged.mcpServers).sort()).toEqual(['alpha', 'beta', 'shared']);
    expect((merged.mcpServers.shared as { command: string }).command).toBe('workspace-shared');
  });

  it('merges skills with workspace overriding global by name', async () => {
    await store.saveSkillsConfig(
      { kind: 'global' },
      {
        skills: [
          { name: 'a', source: { type: 'inline', content: 'global-a' } },
          { name: 'shared', source: { type: 'inline', content: 'global-shared' } },
        ],
      },
    );
    await store.saveSkillsConfig(
      { kind: 'workspace', workspaceId: 'ws1' },
      {
        skills: [
          { name: 'b', source: { type: 'inline', content: 'workspace-b' } },
          { name: 'shared', source: { type: 'inline', content: 'workspace-shared' } },
        ],
      },
    );
    const merged = await store.readMergedConfig('ws1');
    expect(merged.skills.map((s) => s.name).sort()).toEqual(['a', 'b', 'shared']);
    const shared = merged.skills.find((s) => s.name === 'shared')!;
    expect(shared.source).toEqual({ type: 'inline', content: 'workspace-shared' });
  });

  it('configHash changes when config changes, stable otherwise', async () => {
    const a = await store.readMergedConfig('ws1');
    const b = await store.readMergedConfig('ws1');
    expect(a.configHash).toBe(b.configHash);
    await store.saveMCPConfig(
      { kind: 'workspace', workspaceId: 'ws1' },
      { mcpServers: { x: { command: 'x', transport: 'stdio' } } },
    );
    const c = await store.readMergedConfig('ws1');
    expect(c.configHash).not.toBe(a.configHash);
  });

  it('rejects invalid skill source types via validator', () => {
    const result = store.validateSkillsConfig({
      skills: [
        { name: 'ok', source: { type: 'inline', content: 'hi' } },
        { name: 'no-source', source: { type: 'bogus' } },
        { name: '', source: { type: 'inline', content: 'unnamed' } },
        { source: { type: 'inline', content: 'no name field' } },
      ],
    });
    expect(result.skills?.map((s) => s.name)).toEqual(['ok']);
  });

  it('rejects non-object MCP server entries', () => {
    const out = store.validateMCPConfig({
      mcpServers: {
        good: { command: 'x' },
        bad: 'not-an-object',
        alsoBad: null,
      },
    });
    expect(Object.keys(out.mcpServers ?? {})).toEqual(['good']);
  });

  it('writes under the mocked HOME', async () => {
    await store.saveMCPConfig(
      { kind: 'global' },
      { mcpServers: { z: { command: 'z', transport: 'stdio' } } },
    );
    const expected = join(tempHome, 'global', 'mcp.json');
    const stat = await fs.stat(expected);
    expect(stat.isFile()).toBe(true);
  });
});
