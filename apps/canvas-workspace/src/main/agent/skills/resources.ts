import { promises as fs } from 'fs';
import { dirname, join, relative } from 'path';

const MAX_RESOURCE_DEPTH = 4;
const MAX_RESOURCE_FILES = 100;

export async function findSkillResources(
  skillPath: string,
): Promise<Array<{ name: string; path: string }>> {
  const root = dirname(skillPath);
  const resources: Array<{ name: string; path: string }> = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_RESOURCE_DEPTH || resources.length >= MAX_RESOURCE_FILES) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (resources.length >= MAX_RESOURCE_FILES) return;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.isFile() && full !== skillPath) {
        resources.push({ name: relative(root, full), path: full });
      }
    }
  }
  try {
    await walk(root, 0);
  } catch {
    return [];
  }
  return resources.sort((a, b) => a.name.localeCompare(b.name));
}
