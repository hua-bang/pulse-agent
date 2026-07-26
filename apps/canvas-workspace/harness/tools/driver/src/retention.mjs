import { promises as fs } from 'node:fs';
import { join } from 'node:path';

const RUN_RETENTION_LIMIT = 20;
const RUN_DIRECTORY_PATTERN = /^harness-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

export async function pruneRunDirectories(runsDir) {
  const entries = await fs.readdir(runsDir, { withFileTypes: true });
  const removed = entries
    .filter((entry) => entry.isDirectory() && RUN_DIRECTORY_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left))
    .slice(RUN_RETENTION_LIMIT)
    .sort();

  for (const name of removed) {
    await fs.rm(join(runsDir, name), { recursive: true, force: true });
  }

  return removed;
}
