import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface VpsSkillSummary {
  name: string;
  description: string;
  source: 'workspace' | 'user';
  filePath: string;
}

export interface VpsSkillDetail extends VpsSkillSummary {
  content: string;
}

function parseFrontmatter(raw: string): { name?: string; description?: string; body: string } {
  const trimmed = raw.replace(/^\uFEFF/, '');
  if (!trimmed.startsWith('---')) {
    return { body: trimmed };
  }
  const endIdx = trimmed.indexOf('\n---', 3);
  if (endIdx < 0) {
    return { body: trimmed };
  }
  const header = trimmed.slice(3, endIdx);
  const body = trimmed.slice(endIdx + 4).replace(/^\r?\n/, '');
  let name: string | undefined;
  let description: string | undefined;
  for (const line of header.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    const key = match[1].toLowerCase();
    const val = match[2].trim().replace(/^['"]|['"]$/g, '');
    if (key === 'name' && val) name = val;
    if (key === 'description' && val) description = val;
  }
  return { name, description, body };
}

async function scanSkillsDir(
  dir: string,
  source: 'workspace' | 'user',
  out: Map<string, VpsSkillSummary>,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const skillFile = join(dir, entry.name, 'SKILL.md');
    try {
      const raw = await readFile(skillFile, 'utf-8');
      const parsed = parseFrontmatter(raw);
      const name = parsed.name || entry.name;
      if (out.has(name)) continue;
      out.set(name, {
        name,
        description: parsed.description || `Skill loaded from ${entry.name}`,
        source,
        filePath: skillFile,
      });
    } catch {
      // Ignore folders without readable SKILL.md.
    }
  }
}

/**
 * Discover skills in workspace and user directories (.pulse-coder/skills first,
 * preserving .coder/skills compatibility).
 */
export async function listVpsSkills(workDir: string): Promise<VpsSkillSummary[]> {
  const skills = new Map<string, VpsSkillSummary>();
  const home = homedir();
  const searchDirs: Array<{ dir: string; source: 'workspace' | 'user' }> = [
    { dir: join(workDir, '.pulse-coder', 'skills'), source: 'workspace' },
    { dir: join(workDir, '.coder', 'skills'), source: 'workspace' },
    { dir: join(home, '.pulse-coder', 'skills'), source: 'user' },
    { dir: join(home, '.coder', 'skills'), source: 'user' },
  ];
  for (const item of searchDirs) {
    await scanSkillsDir(item.dir, item.source, skills);
  }
  return Array.from(skills.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadVpsSkill(workDir: string, name: string): Promise<VpsSkillDetail | null> {
  const normalized = name.trim();
  if (!normalized) return null;
  const all = await listVpsSkills(workDir);
  const found = all.find((s) => s.name === normalized || s.name.toLowerCase() === normalized.toLowerCase());
  if (!found) return null;
  try {
    const raw = await readFile(found.filePath, 'utf-8');
    const parsed = parseFrontmatter(raw);
    return { ...found, content: parsed.body.slice(0, 24_000) };
  } catch {
    return null;
  }
}
