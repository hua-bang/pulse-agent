/**
 * Canvas user-skill storage — CRUD over SKILL.md files for a given scope.
 *
 * Each skill lives at `<scope>/skills/<slug>/SKILL.md` with standard YAML
 * front matter (`name`, `description`) plus a markdown body, so the engine's
 * skills plugin (which parses with gray-matter) reads them unchanged. We keep
 * a minimal front-matter writer/parser here to avoid pulling gray-matter into
 * the Electron main bundle; the engine remains the runtime source of truth.
 */

import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { unzipSync, strFromU8, strToU8 } from 'fflate';
import {
  prettyPath,
  scopeSkillsDir,
  skillSourceDirs,
  type CanvasConfigScope,
  type CanvasSkillSourceName,
} from '../config-scope';

export interface CanvasSkill {
  /** Unique skill name (also drives the on-disk directory slug). */
  name: string;
  description: string;
  body: string;
}

export interface CanvasSkillEntry extends CanvasSkill {
  scope: 'global' | 'workspace';
  path: string;
  /** Which standard skills directory the file came from. */
  source: CanvasSkillSourceName;
  /**
   * Whether Canvas can edit/delete this skill. False for skills owned by
   * other tools (~/.claude/skills, ~/.codex/skills, ...) — they're shown
   * for visibility but managed elsewhere.
   */
  writable: boolean;
}

export interface CanvasSkillsStatus {
  scope: 'global' | 'workspace';
  dir: string;
  skills: CanvasSkillEntry[];
}

export interface UpsertCanvasSkillInput extends CanvasSkill {
  /** Previous name when renaming, so the old directory can be removed. */
  originalName?: string;
}

function normalizeStr(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Directory slug for a skill name: lowercase, non-alphanumerics collapsed to '-'. */
export function skillSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) throw new Error('Skill name must contain at least one alphanumeric character');
  return slug;
}

/**
 * Serialize a skill to SKILL.md. name/description are emitted as double-quoted
 * YAML scalars (JSON.stringify yields a valid YAML double-quoted string for
 * our single-line values), so colons/quotes in the text stay safe.
 */
function serializeSkill(skill: CanvasSkill): string {
  const name = JSON.stringify(skill.name);
  const description = JSON.stringify(skill.description);
  const body = skill.body.replace(/\s+$/, '');
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
}

/** Best-effort parse of a SKILL.md the UI wrote (front matter + body). */
function parseSkill(content: string): { name: string; description: string; body: string } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!match) return null;
  const [, frontMatter, body] = match;
  let name = '';
  let description = '';
  for (const line of frontMatter.split(/\r?\n/)) {
    const kv = /^(\w+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, rawValue] = kv;
    let value = rawValue.trim();
    if (value.startsWith('"')) {
      try {
        value = JSON.parse(value) as string;
      } catch {
        value = value.replace(/^"|"$/g, '');
      }
    }
    if (key === 'name') name = value;
    else if (key === 'description') description = value;
  }
  if (!name) return null;
  return { name, description, body: body.replace(/^\s+/, '') };
}

/**
 * Recursively find every `SKILL.md` under `base`. Mirrors the engine's
 * `**​/SKILL.md` glob so the UI shows the same set of files the agent will
 * actually load. Missing directories yield an empty result rather than
 * throwing, since most users won't have all six source dirs.
 */
async function findSkillFiles(base: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name === 'SKILL.md') {
        out.push(full);
      }
    }
  }
  await walk(base);
  return out;
}

export async function listCanvasSkills(scope: CanvasConfigScope): Promise<CanvasSkillEntry[]> {
  // Iterate every source dir for the scope, in priority order. Dedupe by
  // realpath (symlinked files) and then by name (case-insensitive) so the
  // higher-priority source — canvas-managed first, then external tools —
  // wins on collisions, matching the engine's first-wins scan rule.
  const sources = skillSourceDirs(scope);
  const skills: CanvasSkillEntry[] = [];
  const seenPaths = new Set<string>();
  const seenNames = new Set<string>();

  for (const src of sources) {
    const files = await findSkillFiles(src.base);
    for (const path of files) {
      let canonical = path;
      try {
        canonical = await fs.realpath(path);
      } catch {
        /* dangling symlink — fall back to the path we already have */
      }
      if (seenPaths.has(canonical)) continue;
      seenPaths.add(canonical);

      let content: string;
      try {
        content = await fs.readFile(path, 'utf8');
      } catch {
        continue;
      }
      const parsed = parseSkill(content);
      if (!parsed) continue;

      const nameKey = parsed.name.toLowerCase();
      if (seenNames.has(nameKey)) continue;
      seenNames.add(nameKey);

      skills.push({
        ...parsed,
        scope: scope.level,
        path,
        source: src.source,
        writable: src.writable,
      });
    }
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

export async function getCanvasSkillsStatus(scope: CanvasConfigScope): Promise<CanvasSkillsStatus> {
  return {
    scope: scope.level,
    dir: prettyPath(scopeSkillsDir(scope)),
    skills: await listCanvasSkills(scope),
  };
}

export async function upsertCanvasSkill(
  scope: CanvasConfigScope,
  input: UpsertCanvasSkillInput,
): Promise<CanvasSkillsStatus> {
  const name = normalizeStr(input.name);
  const description = normalizeStr(input.description);
  if (!name) throw new Error('Skill name is required');
  if (!description) throw new Error('Skill description is required');

  const slug = skillSlug(name);
  const skillsDir = scopeSkillsDir(scope);
  const targetDir = join(skillsDir, slug);
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(join(targetDir, 'SKILL.md'), serializeSkill({ name, description, body: input.body ?? '' }), 'utf8');

  // Rename: drop the previous directory when the slug changed.
  const originalName = normalizeStr(input.originalName);
  if (originalName) {
    const originalSlug = skillSlug(originalName);
    if (originalSlug !== slug) {
      await fs.rm(join(skillsDir, originalSlug), { recursive: true, force: true });
    }
  }

  return getCanvasSkillsStatus(scope);
}

export async function removeCanvasSkill(
  scope: CanvasConfigScope,
  name: string,
): Promise<CanvasSkillsStatus> {
  const slug = skillSlug(normalizeStr(name));
  await fs.rm(join(scopeSkillsDir(scope), slug), { recursive: true, force: true });
  return getCanvasSkillsStatus(scope);
}

// ─── Pasted SKILL.md import ──────────────────────────────────────────
//
// The fastest path for "I'm reading a SKILL.md somewhere and just want it":
// paste the file's contents verbatim. Reuses the same on-disk shape and
// validation as a zip import, just for one skill.

export interface CanvasSkillMdImportResult {
  status: CanvasSkillsStatus;
  /** 'imported' for a new skill, 'replaced' when overwriting one of the same name. */
  result: 'imported' | 'replaced';
  name: string;
}

export async function importCanvasSkillMd(
  scope: CanvasConfigScope,
  text: string,
): Promise<CanvasSkillMdImportResult> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Pasted content is empty');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(trimmed);
  if (!match) {
    throw new Error('Expected a SKILL.md with YAML front matter (--- name + description ---)');
  }
  const fm = parseFrontMatterOnly(strToU8(trimmed));
  if (!fm.name || !fm.description) {
    throw new Error('SKILL.md must declare both `name` and `description` in the front matter');
  }
  const slug = skillSlug(fm.name);
  const targetDir = join(scopeSkillsDir(scope), slug);
  let existed = false;
  try {
    await fs.access(join(targetDir, 'SKILL.md'));
    existed = true;
  } catch {
    /* fresh */
  }
  await upsertCanvasSkill(scope, {
    name: fm.name,
    description: fm.description,
    body: match[2].replace(/^\s+/, ''),
  });
  return {
    status: await getCanvasSkillsStatus(scope),
    result: existed ? 'replaced' : 'imported',
    name: fm.name,
  };
}

// ─── URL import ───────────────────────────────────────────────────────
//
// Paste a URL — we fetch, sniff, and route to the existing md/zip importer.
// GitHub blob URLs are auto-rewritten to raw.githubusercontent.com so the
// user doesn't have to remember; a Content-Type / magic-byte check picks
// between SKILL.md text and a zip bundle.

const SKILL_URL_FETCH_TIMEOUT_MS = 10_000;
const SKILL_URL_MAX_BYTES = 5 * 1024 * 1024;

export type CanvasSkillUrlImportResult =
  | ({ kind: 'md' } & CanvasSkillMdImportResult)
  | ({ kind: 'zip' } & CanvasSkillImportResult);

/**
 * Rewrite `github.com/<owner>/<repo>/blob/<branch>/<path>` to
 * `raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>` so users can
 * paste the URL they're looking at in their browser. Other hosts (incl.
 * `raw.githubusercontent.com` already) pass through unchanged.
 */
export function toRawGitHubUrl(url: URL): URL {
  if (url.hostname !== 'github.com') return url;
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
  if (!match) return url;
  const [, owner, repo, rest] = match;
  return new URL(`https://raw.githubusercontent.com/${owner}/${repo}/${rest}`);
}

export async function importCanvasSkillFromUrl(
  scope: CanvasConfigScope,
  urlStr: string,
): Promise<CanvasSkillUrlImportResult> {
  let url: URL;
  try {
    url = new URL(urlStr.trim());
  } catch {
    throw new Error(`Invalid URL: ${urlStr}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported URL scheme: ${url.protocol}`);
  }
  url = toRawGitHubUrl(url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SKILL_URL_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url.toString(), { signal: controller.signal });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      throw new Error(`Fetch timed out after ${SKILL_URL_FETCH_TIMEOUT_MS}ms`);
    }
    throw new Error(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new Error(`Fetch failed: HTTP ${response.status} ${response.statusText}`);
  }

  const buf = new Uint8Array(await response.arrayBuffer());
  if (buf.length === 0) throw new Error('Fetched content is empty');
  if (buf.length > SKILL_URL_MAX_BYTES) {
    throw new Error(
      `Content too large (${buf.length} bytes; max ${SKILL_URL_MAX_BYTES})`,
    );
  }

  // Detect zip by PK\x03\x04 magic bytes; otherwise decode as UTF-8 text.
  const isZip =
    buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  if (isZip) {
    const result = await importCanvasSkillsZip(scope, buf);
    return { kind: 'zip', ...result };
  }
  const result = await importCanvasSkillMd(scope, strFromU8(buf));
  return { kind: 'md', ...result };
}

// ─── Zip import ───────────────────────────────────────────────────────
//
// Supports two packaging conventions, both common in the wild:
//   - Single-skill zip: `SKILL.md` at the root, optionally with adjacent
//     resource files.
//   - Multi-skill zip: `<name>/SKILL.md` per skill, with each skill's
//     adjacent files staying inside its directory.
//
// We walk every entry, group by the directory containing each SKILL.md, and
// copy that group into `<scopeSkillsDir>/<slug>/`. The slug comes from the
// SKILL.md front-matter `name` (not the zip directory name) so users can
// rename folders without breaking the registry.

export interface CanvasSkillImportEntryResult {
  name: string;
  status: 'imported' | 'replaced' | 'skipped';
  reason?: string;
}

export interface CanvasSkillImportResult {
  status: CanvasSkillsStatus;
  entries: CanvasSkillImportEntryResult[];
}

/** Parse just the front matter; used for zip entries before we touch disk. */
function parseFrontMatterOnly(bytes: Uint8Array): { name?: string; description?: string } {
  const text = strFromU8(bytes);
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  const out: { name?: string; description?: string } = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^(\w+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value.startsWith('"')) {
      try {
        value = JSON.parse(value) as string;
      } catch {
        value = value.replace(/^"|"$/g, '');
      }
    }
    if (kv[1] === 'name') out.name = value;
    else if (kv[1] === 'description') out.description = value;
  }
  return out;
}

export async function importCanvasSkillsZip(
  scope: CanvasConfigScope,
  bytes: Uint8Array,
): Promise<CanvasSkillImportResult> {
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(bytes);
  } catch (err) {
    throw new Error(`Failed to read zip: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Group entries by the directory containing each SKILL.md (the prefix path,
  // empty string for a root-level SKILL.md).
  const groups = new Map<string, { skillFile: Uint8Array; siblings: Map<string, Uint8Array> }>();
  for (const [rawPath, content] of Object.entries(unzipped)) {
    // fflate yields trailing-slash entries for directories; skip them.
    if (rawPath.endsWith('/')) continue;
    // Normalize separators and strip leading "./".
    const path = rawPath.replace(/\\/g, '/').replace(/^\.\//, '');
    const base = path.split('/').pop() ?? '';
    if (base.toUpperCase() !== 'SKILL.MD') continue;
    const dir = dirname(path);
    const dirKey = dir === '.' ? '' : dir;
    if (!groups.has(dirKey)) {
      groups.set(dirKey, { skillFile: content, siblings: new Map() });
    }
  }
  // Second pass: attach sibling files (anything under the group dir, excluding
  // the SKILL.md itself). Files outside any group's dir are ignored.
  for (const [rawPath, content] of Object.entries(unzipped)) {
    if (rawPath.endsWith('/')) continue;
    const path = rawPath.replace(/\\/g, '/').replace(/^\.\//, '');
    const base = path.split('/').pop() ?? '';
    if (base.toUpperCase() === 'SKILL.MD') continue;
    // Find the longest group key that prefixes this path.
    let bestKey: string | null = null;
    for (const key of groups.keys()) {
      const prefix = key === '' ? '' : `${key}/`;
      if ((key === '' || path.startsWith(prefix)) && (bestKey === null || key.length > bestKey.length)) {
        bestKey = key;
      }
    }
    if (bestKey === null) continue;
    const relative = bestKey === '' ? path : path.slice(bestKey.length + 1);
    groups.get(bestKey)!.siblings.set(relative, content);
  }

  if (groups.size === 0) {
    throw new Error('Zip contains no SKILL.md');
  }

  const skillsDir = scopeSkillsDir(scope);
  const entries: CanvasSkillImportEntryResult[] = [];

  for (const [dirKey, group] of groups) {
    const fm = parseFrontMatterOnly(group.skillFile);
    if (!fm.name || !fm.description) {
      entries.push({
        name: dirKey || '(root)',
        status: 'skipped',
        reason: 'SKILL.md missing name or description',
      });
      continue;
    }
    let slug: string;
    try {
      slug = skillSlug(fm.name);
    } catch (err) {
      entries.push({
        name: fm.name,
        status: 'skipped',
        reason: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const targetDir = join(skillsDir, slug);
    // Detect replace BEFORE touching disk so the summary reflects the user's
    // mental model ("did this overwrite something?").
    let existed = false;
    try {
      await fs.access(join(targetDir, 'SKILL.md'));
      existed = true;
    } catch {
      /* fresh */
    }

    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(join(targetDir, 'SKILL.md'), Buffer.from(group.skillFile));
    for (const [rel, content] of group.siblings) {
      const dest = join(targetDir, rel);
      await fs.mkdir(dirname(dest), { recursive: true });
      await fs.writeFile(dest, Buffer.from(content));
    }
    entries.push({ name: fm.name, status: existed ? 'replaced' : 'imported' });
  }

  return { status: await getCanvasSkillsStatus(scope), entries };
}
