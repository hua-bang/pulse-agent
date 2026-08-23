import { promises as fs } from 'fs';
import { basename, dirname, join } from 'path';
import type {
  PluginPackageDiagnostic,
  PluginPackageSkill,
} from '../../shared/plugin-market';
import {
  containedRealpath,
  diagnostic,
  errorMessage,
  isRecord,
  pathExists,
  resolvePackagePath,
} from './package-reader-support';

function frontmatterScalar(raw: string): string | null {
  const value = raw.trim();
  if (!value || value === '|' || value === '>') return null;
  if (value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return typeof parsed === 'string' ? parsed : null;
    } catch {
      return null;
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value.replace(/\s+#.*$/, '').trim();
}

export function parseSkillMetadata(
  content: string,
  directoryName: string,
  requireDirectoryMatch = true,
): { name: string; description: string } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) return null;
  let name: string | null = null;
  let description: string | null = null;
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^(name|description)\s*:\s*(.*)$/.exec(line);
    if (!field) continue;
    const value = frontmatterScalar(field[2]);
    if (field[1] === 'name') name = value;
    else description = value;
  }
  if (
    !name
    || (requireDirectoryMatch && name !== directoryName)
    || name.length > 64
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
    || !description
    || description.length > 1024
  ) return null;
  return { name, description };
}

async function readSkill(
  root: string,
  directory: string,
  skillPath: string,
): Promise<PluginPackageSkill> {
  const canonicalSkill = await containedRealpath(root, skillPath);
  if (!(await fs.stat(canonicalSkill)).isFile()) throw new Error('SKILL.md is not a regular file');
  const metadata = parseSkillMetadata(await fs.readFile(canonicalSkill, 'utf8'), basename(directory));
  if (!metadata) throw new Error('SKILL.md has invalid Agent Skills name or description frontmatter');
  return { ...metadata, directory, skillPath: canonicalSkill };
}

export async function discoverSkills(
  root: string,
  diagnostics: PluginPackageDiagnostic[],
): Promise<PluginPackageSkill[]> {
  const candidate = join(root, 'skills');
  try {
    if (!await pathExists(candidate)) return [];
  } catch (error) {
    diagnostics.push(diagnostic('error', 'skills', 'skills.unreadable', errorMessage(error), candidate));
    return [];
  }
  let skillsRoot: string;
  try {
    skillsRoot = await containedRealpath(root, candidate);
    if (!(await fs.stat(skillsRoot)).isDirectory()) throw new Error('skills must resolve to a directory');
  } catch (error) {
    diagnostics.push(diagnostic('error', 'skills', 'skills.invalid-location', errorMessage(error), candidate));
    return [];
  }

  let entries: import('fs').Dirent[];
  try {
    entries = (await fs.readdir(skillsRoot, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    diagnostics.push(diagnostic('error', 'skills', 'skills.unreadable', errorMessage(error), skillsRoot));
    return [];
  }

  const skills: PluginPackageSkill[] = [];
  for (const entry of entries) {
    const childCandidate = join(skillsRoot, entry.name);
    let directory: string;
    try {
      directory = await containedRealpath(root, childCandidate);
      if (!(await fs.stat(directory)).isDirectory()) continue;
    } catch (error) {
      diagnostics.push(diagnostic(
        'error', 'skill', 'skill.invalid-directory', errorMessage(error), childCandidate, entry.name,
      ));
      continue;
    }
    const skillCandidate = join(directory, 'SKILL.md');
    if (!await pathExists(skillCandidate)) continue;
    try {
      skills.push(await readSkill(root, directory, skillCandidate));
    } catch (error) {
      diagnostics.push(diagnostic(
        'error', 'skill', 'skill.invalid', errorMessage(error), skillCandidate, entry.name,
      ));
    }
  }
  return skills;
}

export async function readLegacySkills(
  root: string,
  value: unknown,
  diagnostics: PluginPackageDiagnostic[],
): Promise<PluginPackageSkill[]> {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    diagnostics.push(diagnostic(
      'error', 'skills', 'skills.invalid-legacy-list', 'Legacy manifest skills must be an array',
    ));
    return [];
  }
  const skills: PluginPackageSkill[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    const componentId = isRecord(item) && typeof item.name === 'string' ? item.name : String(index);
    try {
      if (!isRecord(item) || typeof item.path !== 'string' || !item.path.trim()) {
        throw new Error('Legacy skill must contain a relative path');
      }
      const declared = item.path.trim();
      const skillPath = declared.endsWith('SKILL.md')
        ? await resolvePackagePath(root, declared, 'file')
        : await resolvePackagePath(root, join(declared, 'SKILL.md'), 'file');
      if (seen.has(skillPath)) continue;
      seen.add(skillPath);
      const directory = dirname(skillPath);
      let parsed: { name: string; description: string } | null = null;
      try {
        parsed = parseSkillMetadata(await fs.readFile(skillPath, 'utf8'), basename(directory), false);
      } catch {
        // Legacy metadata remains authoritative when the file itself is not readable yet.
      }
      const declaredName = typeof item.name === 'string' ? item.name.trim() : '';
      const declaredDescription = typeof item.description === 'string' ? item.description.trim() : '';
      const name = declaredName || parsed?.name || basename(directory);
      const description = declaredDescription
        || parsed?.description
        || `Legacy Canvas skill ${name}`;
      skills.push({ name, description, directory, skillPath });
    } catch (error) {
      diagnostics.push(diagnostic(
        'error', 'skill', 'skill.invalid', errorMessage(error), join(root, 'manifest.json'), componentId,
      ));
    }
  }
  return skills;
}
