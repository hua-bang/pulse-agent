/**
 * Remote skill fetcher — materialises `WorkspaceSkillEntry` source specs
 * (url / git) into a local cache directory so the engine can load them as
 * regular `SkillInfo` records.
 *
 * Cache layout: ~/.pulse-coder/canvas/skills-cache/<sha256(source)>/SKILL.md
 *
 * The cache key is content-addressable on the *source spec* (not the
 * contents), so the same URL hits the same cache slot across workspaces.
 * We always re-download on `materialiseSkill()` — at this layer we don't
 * try to be clever about freshness (the workspace-config plugin throttles
 * how often it reconciles, which is the natural rate limit).
 *
 * For `inline` sources the caller resolves them directly without coming
 * through here (the content is in the config file already).
 */

import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import { homedir } from 'os';
import { join } from 'path';
import { spawn } from 'child_process';
import matter from 'gray-matter';
import type { SkillInfo } from 'pulse-coder-engine';
import type { SkillSource, WorkspaceSkillEntry } from './workspace-config-store';

const CACHE_ROOT = join(homedir(), '.pulse-coder', 'canvas', 'skills-cache');

function sourceHash(source: SkillSource): string {
  // Hash the canonical source spec — same URL+ref → same slot.
  const canon = JSON.stringify(source, Object.keys(source).sort());
  return createHash('sha256').update(canon).digest('hex').slice(0, 16);
}

async function ensureCacheDir(key: string): Promise<string> {
  const dir = join(CACHE_ROOT, key);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

interface ParsedSkill {
  name?: string;
  description?: string;
  content: string;
  metadata: Record<string, unknown>;
}

function parseSkillMarkdown(raw: string): ParsedSkill {
  const { data, content } = matter(raw);
  return {
    name: typeof data.name === 'string' ? data.name : undefined,
    description: typeof data.description === 'string' ? data.description : undefined,
    content,
    metadata: data,
  };
}

// ---------------------------------------------------------------------------
// URL fetch
// ---------------------------------------------------------------------------

async function fetchUrlSkill(
  source: Extract<SkillSource, { type: 'url' }>,
  entry: WorkspaceSkillEntry,
): Promise<SkillInfo> {
  const res = await fetch(source.url, { headers: source.headers });
  if (!res.ok) {
    throw new Error(`URL fetch failed (${res.status} ${res.statusText})`);
  }
  const text = await res.text();
  const key = sourceHash(source);
  const dir = await ensureCacheDir(key);
  const filePath = join(dir, 'SKILL.md');
  await fs.writeFile(filePath, text, 'utf-8');

  const parsed = parseSkillMarkdown(text);
  return {
    name: entry.name || parsed.name || `remote-${key}`,
    description: entry.description ?? parsed.description ?? '',
    location: filePath,
    content: parsed.content,
    metadata: { ...parsed.metadata, source: { type: 'url', url: source.url } },
  };
}

// ---------------------------------------------------------------------------
// Git fetch
// ---------------------------------------------------------------------------

function runGit(args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`git ${args.join(' ')} exited with ${code}: ${stderr.trim()}`));
    });
  });
}

async function fetchGitSkill(
  source: Extract<SkillSource, { type: 'git' }>,
  entry: WorkspaceSkillEntry,
): Promise<SkillInfo> {
  const key = sourceHash(source);
  const repoDir = join(CACHE_ROOT, key, 'repo');
  let needClone = true;
  try {
    const stat = await fs.stat(join(repoDir, '.git'));
    needClone = !stat.isDirectory();
  } catch {
    needClone = true;
  }

  if (needClone) {
    await fs.rm(repoDir, { recursive: true, force: true });
    await fs.mkdir(repoDir, { recursive: true });
    await runGit(['clone', '--depth', '1', source.url, repoDir]);
  } else {
    // Best-effort refresh; ignore failures so an offline user still gets
    // the cached copy.
    try {
      await runGit(['fetch', '--depth', '1', 'origin'], repoDir);
      await runGit(['reset', '--hard', source.ref ? `origin/${source.ref}` : 'FETCH_HEAD'], repoDir);
    } catch (err) {
      console.warn(`[skill-fetcher] git refresh failed for ${source.url}, using cache: ${(err as Error).message}`);
    }
  }

  if (source.ref && needClone) {
    try {
      await runGit(['checkout', source.ref], repoDir);
    } catch (err) {
      console.warn(`[skill-fetcher] git checkout ${source.ref} failed: ${(err as Error).message}`);
    }
  }

  const skillRelPath = source.path ?? 'SKILL.md';
  const skillAbsPath = join(repoDir, skillRelPath);
  const raw = await fs.readFile(skillAbsPath, 'utf-8');
  const parsed = parseSkillMarkdown(raw);

  return {
    name: entry.name || parsed.name || `git-${key}`,
    description: entry.description ?? parsed.description ?? '',
    location: skillAbsPath,
    content: parsed.content,
    metadata: {
      ...parsed.metadata,
      source: { type: 'git', url: source.url, ref: source.ref, path: skillRelPath },
    },
  };
}

// ---------------------------------------------------------------------------
// Top-level dispatch
// ---------------------------------------------------------------------------

export async function materialiseSkill(entry: WorkspaceSkillEntry): Promise<SkillInfo> {
  if (entry.source.type === 'inline') {
    const parsed = parseSkillMarkdown(entry.source.content);
    return {
      name: entry.name,
      description: entry.description ?? parsed.description ?? '',
      location: `inline:${entry.name}`,
      content: parsed.content || entry.source.content,
      metadata: { ...parsed.metadata, source: { type: 'inline' } },
    };
  }
  if (entry.source.type === 'url') {
    return fetchUrlSkill(entry.source, entry);
  }
  return fetchGitSkill(entry.source, entry);
}

/**
 * Materialise every entry in parallel, swallowing per-entry failures so a
 * single bad URL doesn't drop the whole skill set.
 */
export async function materialiseSkills(entries: WorkspaceSkillEntry[]): Promise<SkillInfo[]> {
  const results = await Promise.allSettled(entries.map(materialiseSkill));
  const out: SkillInfo[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') out.push(r.value);
    else
      console.warn(
        `[skill-fetcher] failed to materialise "${entries[i].name}" (${entries[i].source.type}): ${(r.reason as Error).message}`,
      );
  });
  return out;
}
