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
  importCanvasSkillFromUrl,
  importCanvasSkillMd,
  importCanvasSkillsZip,
  listCanvasSkills,
  toRawGitHubUrl,
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

  it('accepts the DeepWiki-style `serverUrl` alias and infers http', async () => {
    const result = await importCanvasMcpJson(
      GLOBAL,
      JSON.stringify({
        mcpServers: {
          deepwiki: { serverUrl: 'https://mcp.deepwiki.com/mcp' },
        },
      }),
    );
    expect(result.entries).toEqual([{ name: 'deepwiki', status: 'added' }]);
    const [server] = result.status.servers;
    expect(server).toMatchObject({
      name: 'deepwiki',
      transport: 'http',
      url: 'https://mcp.deepwiki.com/mcp',
    });
  });

  it('accepts `httpUrl` as a synonym of `url`', async () => {
    const result = await importCanvasMcpJson(
      GLOBAL,
      JSON.stringify({ mcpServers: { x: { httpUrl: 'https://x' } } }),
    );
    expect(result.entries).toEqual([{ name: 'x', status: 'added' }]);
    expect(result.status.servers[0]).toMatchObject({ transport: 'http', url: 'https://x' });
  });

  it('treats `sseUrl` as a transport hint and uses sse', async () => {
    const result = await importCanvasMcpJson(
      GLOBAL,
      JSON.stringify({ mcpServers: { y: { sseUrl: 'https://y/sse' } } }),
    );
    expect(result.entries).toEqual([{ name: 'y', status: 'added' }]);
    expect(result.status.servers[0]).toMatchObject({ transport: 'sse', url: 'https://y/sse' });
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

describe('toRawGitHubUrl', () => {
  it('rewrites github.com blob URLs to raw.githubusercontent.com', () => {
    const out = toRawGitHubUrl(
      new URL('https://github.com/anthropic/cookbook/blob/main/skills/code-review/SKILL.md'),
    );
    expect(out.toString()).toBe(
      'https://raw.githubusercontent.com/anthropic/cookbook/main/skills/code-review/SKILL.md',
    );
  });

  it('preserves nested path segments after the branch', () => {
    const out = toRawGitHubUrl(
      new URL('https://github.com/owner/repo/blob/feature/x/dir/sub/SKILL.md'),
    );
    expect(out.pathname).toBe('/owner/repo/feature/x/dir/sub/SKILL.md');
  });

  it('leaves non-github URLs alone', () => {
    const original = new URL('https://example.com/foo/bar');
    expect(toRawGitHubUrl(original).toString()).toBe(original.toString());
  });

  it('leaves github.com tree URLs alone (we only support blob → raw)', () => {
    const original = new URL('https://github.com/owner/repo/tree/main/skills');
    expect(toRawGitHubUrl(original).toString()).toBe(original.toString());
  });
});

describe('importCanvasSkillFromUrl', () => {
  const md = [
    '---',
    'name: "from-url"',
    'description: "When this happens, do that"',
    '---',
    '',
    '1. Step one.',
    '',
  ].join('\n');

  function mockResponse(body: BodyInit, init: ResponseInit = { status: 200, statusText: 'OK' }) {
    return new Response(body, init);
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches a SKILL.md text URL and routes to the md importer', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(md));
    const result = await importCanvasSkillFromUrl(
      GLOBAL,
      'https://raw.githubusercontent.com/x/y/main/SKILL.md',
    );
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(result.kind).toBe('md');
    if (result.kind === 'md') {
      expect(result.name).toBe('from-url');
      expect(result.result).toBe('imported');
    }
    expect((await listCanvasSkills(GLOBAL)).map((s) => s.name)).toContain('from-url');
  });

  it('fetches a zip URL (PK magic bytes) and routes to the zip importer', async () => {
    const bytes = zipSync({
      'demo/SKILL.md': strToU8(md.replace('from-url', 'from-zip-url').replace(/from-url/g, 'from-zip-url')),
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(bytes as unknown as ArrayBuffer),
    );
    const result = await importCanvasSkillFromUrl(GLOBAL, 'https://example.com/skill.zip');
    expect(result.kind).toBe('zip');
    if (result.kind === 'zip') {
      expect(result.entries.map((e) => e.name)).toContain('from-zip-url');
    }
  });

  it('rewrites a github.com blob URL to raw before fetching', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(md));
    await importCanvasSkillFromUrl(
      GLOBAL,
      'https://github.com/anthropic/cookbook/blob/main/skills/from-url/SKILL.md',
    );
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [calledUrl] = fetchSpy.mock.calls[0];
    expect(String(calledUrl)).toBe(
      'https://raw.githubusercontent.com/anthropic/cookbook/main/skills/from-url/SKILL.md',
    );
  });

  it('throws on an invalid URL', async () => {
    await expect(importCanvasSkillFromUrl(GLOBAL, 'not a url')).rejects.toThrow(/Invalid URL/);
  });

  it('rejects unsupported schemes', async () => {
    await expect(importCanvasSkillFromUrl(GLOBAL, 'file:///etc/passwd')).rejects.toThrow(
      /Unsupported URL scheme/,
    );
  });

  it('surfaces non-2xx HTTP responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse('not found', { status: 404, statusText: 'Not Found' }),
    );
    await expect(
      importCanvasSkillFromUrl(GLOBAL, 'https://example.com/missing'),
    ).rejects.toThrow(/HTTP 404/);
  });

  it('throws on an empty response body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(new Uint8Array(0)));
    await expect(
      importCanvasSkillFromUrl(GLOBAL, 'https://example.com/empty'),
    ).rejects.toThrow(/empty/);
  });
});
