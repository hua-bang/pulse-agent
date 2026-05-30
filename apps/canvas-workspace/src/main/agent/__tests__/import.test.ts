import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { strToU8, zipSync } from 'fflate';

const { sandboxHome } = vi.hoisted(() => {
  const base = process.env.TMPDIR || process.env.TEMP || '/tmp';
  const trailing = base.endsWith('/') ? '' : '/';
  return {
    sandboxHome: `${base}${trailing}canvas-import-test-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => sandboxHome };
});

import { importCanvasMcpJson, getCanvasMcpStatus } from '../mcp/config';
import {
  importCanvasSkillMd,
  importCanvasSkillsZip,
  listCanvasSkills,
} from '../skills/config';

const GLOBAL = { level: 'global' as const };

beforeEach(async () => {
  await fs.mkdir(join(sandboxHome, '.pulse-coder', 'canvas'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(join(sandboxHome, '.pulse-coder'), { recursive: true, force: true });
});

describe('importCanvasMcpJson', () => {
  it('accepts the native { servers } shape', async () => {
    const result = await importCanvasMcpJson(
      GLOBAL,
      JSON.stringify({
        servers: {
          notion: { transport: 'http', url: 'https://mcp.notion.com/sse' },
        },
      }),
    );
    expect(result.entries).toEqual([{ name: 'notion', status: 'added' }]);
    expect(result.status.servers).toHaveLength(1);
    expect(result.status.servers[0]).toMatchObject({
      name: 'notion',
      transport: 'http',
      url: 'https://mcp.notion.com/sse',
    });
  });

  it('accepts the Claude Desktop { mcpServers } shape and infers stdio from command', async () => {
    const result = await importCanvasMcpJson(
      GLOBAL,
      JSON.stringify({
        mcpServers: {
          github: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
            env: { GITHUB_TOKEN: 'xxx' },
          },
        },
      }),
    );
    expect(result.entries).toEqual([{ name: 'github', status: 'added' }]);
    const [server] = result.status.servers;
    expect(server).toMatchObject({
      name: 'github',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_TOKEN: 'xxx' },
    });
  });

  it('marks existing servers as replaced, leaves unrelated ones intact', async () => {
    // Seed two servers.
    await importCanvasMcpJson(
      GLOBAL,
      JSON.stringify({
        servers: {
          notion: { transport: 'http', url: 'https://a' },
          linear: { transport: 'http', url: 'https://b' },
        },
      }),
    );
    // Re-import only notion, with a different URL.
    const result = await importCanvasMcpJson(
      GLOBAL,
      JSON.stringify({
        servers: { notion: { transport: 'http', url: 'https://new' } },
      }),
    );
    expect(result.entries).toEqual([{ name: 'notion', status: 'replaced' }]);
    const status = await getCanvasMcpStatus(GLOBAL);
    expect(status.servers.map((s) => s.name).sort()).toEqual(['linear', 'notion']);
    expect(status.servers.find((s) => s.name === 'notion')?.url).toBe('https://new');
    expect(status.servers.find((s) => s.name === 'linear')?.url).toBe('https://b');
  });

  it('skips malformed entries with a reason but still writes valid ones', async () => {
    const result = await importCanvasMcpJson(
      GLOBAL,
      JSON.stringify({
        mcpServers: {
          good: { command: 'foo' },
          bad: { transport: 'http' /* missing url */ },
        },
      }),
    );
    const byName = Object.fromEntries(result.entries.map((e) => [e.name, e]));
    expect(byName.good.status).toBe('added');
    expect(byName.bad.status).toBe('skipped');
    expect(byName.bad.reason).toMatch(/url/i);
  });

  it('throws on garbage input', async () => {
    await expect(importCanvasMcpJson(GLOBAL, 'not json')).rejects.toThrow(/Invalid JSON/);
    await expect(importCanvasMcpJson(GLOBAL, '{}')).rejects.toThrow(/servers/);
  });
});

function makeSkillMd(name: string, description: string, body: string): Uint8Array {
  return strToU8(
    [
      '---',
      `name: ${JSON.stringify(name)}`,
      `description: ${JSON.stringify(description)}`,
      '---',
      '',
      body,
      '',
    ].join('\n'),
  );
}

describe('importCanvasSkillsZip', () => {
  it('imports a single-skill zip (SKILL.md at root) with adjacent resources', async () => {
    const bytes = zipSync({
      'SKILL.md': makeSkillMd('code-review', 'When reviewing code', '1. Step one.'),
      'scripts/helper.sh': strToU8('#!/bin/sh\necho hi\n'),
    });
    const result = await importCanvasSkillsZip(GLOBAL, bytes);
    expect(result.entries).toEqual([{ name: 'code-review', status: 'imported' }]);

    const skills = await listCanvasSkills(GLOBAL);
    expect(skills.map((s) => s.name)).toEqual(['code-review']);
    // Resource file should have been copied alongside SKILL.md.
    const helper = await fs.readFile(
      join(sandboxHome, '.pulse-coder', 'canvas', 'skills', 'code-review', 'scripts', 'helper.sh'),
      'utf8',
    );
    expect(helper).toContain('echo hi');
  });

  it('imports a multi-skill zip and tracks replaced vs imported on re-run', async () => {
    const bytes = zipSync({
      'code-review/SKILL.md': makeSkillMd('code-review', 'When reviewing code', 'A.'),
      'bug-trace/SKILL.md': makeSkillMd('bug-trace', 'When debugging', 'B.'),
    });
    const first = await importCanvasSkillsZip(GLOBAL, bytes);
    expect(first.entries.map((e) => e.status).sort()).toEqual(['imported', 'imported']);
    expect((await listCanvasSkills(GLOBAL)).map((s) => s.name).sort()).toEqual([
      'bug-trace',
      'code-review',
    ]);

    // Second import with one new + one existing: existing is "replaced".
    const bytes2 = zipSync({
      'code-review/SKILL.md': makeSkillMd('code-review', 'Updated desc', 'A2.'),
      'login-trace/SKILL.md': makeSkillMd('login-trace', 'When debugging login', 'C.'),
    });
    const second = await importCanvasSkillsZip(GLOBAL, bytes2);
    const byName = Object.fromEntries(second.entries.map((e) => [e.name, e.status]));
    expect(byName).toEqual({ 'code-review': 'replaced', 'login-trace': 'imported' });
  });

  it('skips SKILL.md missing required front matter without failing the whole zip', async () => {
    const bytes = zipSync({
      'good/SKILL.md': makeSkillMd('good', 'When this happens', 'ok'),
      'broken/SKILL.md': strToU8('no front matter here'),
    });
    const result = await importCanvasSkillsZip(GLOBAL, bytes);
    const byName = Object.fromEntries(result.entries.map((e) => [e.name, e]));
    expect(byName.good.status).toBe('imported');
    expect(byName.broken.status).toBe('skipped');
    expect((await listCanvasSkills(GLOBAL)).map((s) => s.name)).toEqual(['good']);
  });

  it('throws when the zip has no SKILL.md anywhere', async () => {
    const bytes = zipSync({ 'README.md': strToU8('hello') });
    await expect(importCanvasSkillsZip(GLOBAL, bytes)).rejects.toThrow(/SKILL\.md/);
  });
});

describe('importCanvasSkillMd', () => {
  const md = [
    '---',
    'name: "code-review"',
    'description: "When reviewing code"',
    '---',
    '',
    '1. Step one.',
    '',
  ].join('\n');

  it('imports a fresh SKILL.md and reports "imported"', async () => {
    const result = await importCanvasSkillMd(GLOBAL, md);
    expect(result.result).toBe('imported');
    expect(result.name).toBe('code-review');
    expect((await listCanvasSkills(GLOBAL)).map((s) => s.name)).toEqual(['code-review']);
  });

  it('reports "replaced" when a skill of the same name already exists', async () => {
    await importCanvasSkillMd(GLOBAL, md);
    const second = await importCanvasSkillMd(
      GLOBAL,
      md.replace('When reviewing code', 'Updated description'),
    );
    expect(second.result).toBe('replaced');
    const skills = await listCanvasSkills(GLOBAL);
    expect(skills.find((s) => s.name === 'code-review')?.description).toBe('Updated description');
  });

  it('rejects content without front matter', async () => {
    await expect(importCanvasSkillMd(GLOBAL, '# just markdown')).rejects.toThrow(/front matter/);
  });

  it('rejects content missing name or description', async () => {
    const noDesc = '---\nname: "foo"\n---\n\nbody';
    await expect(importCanvasSkillMd(GLOBAL, noDesc)).rejects.toThrow(/name.*description|description.*name/);
  });

  it('rejects empty input', async () => {
    await expect(importCanvasSkillMd(GLOBAL, '   ')).rejects.toThrow(/empty/);
  });
});
