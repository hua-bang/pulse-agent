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
import { join } from 'path';
import { scopeSkillsDir, type CanvasConfigScope } from '../config-scope';

export interface CanvasSkill {
  /** Unique skill name (also drives the on-disk directory slug). */
  name: string;
  description: string;
  body: string;
}

export interface CanvasSkillEntry extends CanvasSkill {
  scope: 'global' | 'workspace';
  path: string;
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

export async function listCanvasSkills(scope: CanvasConfigScope): Promise<CanvasSkillEntry[]> {
  const dir = scopeSkillsDir(scope);
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err: any) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }

  const skills: CanvasSkillEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(dir, entry.name, 'SKILL.md');
    let content: string;
    try {
      content = await fs.readFile(path, 'utf8');
    } catch {
      continue;
    }
    const parsed = parseSkill(content);
    if (!parsed) continue;
    skills.push({ ...parsed, scope: scope.level, path });
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

export async function getCanvasSkillsStatus(scope: CanvasConfigScope): Promise<CanvasSkillsStatus> {
  return {
    scope: scope.level,
    dir: scopeSkillsDir(scope),
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
