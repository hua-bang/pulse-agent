import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';

const DEFAULT_MAX_ENTRIES = 200;

/**
 * Persists composer prompt history across CLI sessions.
 * Storage: `~/.pulse-coder/history.json` — `{ "entries": ["oldest", ..., "newest"] }`.
 */
export class PromptHistoryStore {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath = path.join(homedir(), '.pulse-coder', 'history.json'),
    private readonly maxEntries = DEFAULT_MAX_ENTRIES,
  ) {}

  async load(): Promise<string[]> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as { entries?: unknown };
      if (!Array.isArray(parsed.entries)) {
        return [];
      }
      return parsed.entries.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
    } catch {
      return [];
    }
  }

  append(entry: string): Promise<void> {
    const trimmed = entry.trim();
    if (!trimmed) {
      return this.writeQueue;
    }

    this.writeQueue = this.writeQueue.then(async () => {
      const entries = await this.load();
      if (entries[entries.length - 1] === trimmed) {
        return;
      }
      entries.push(trimmed);
      const capped = entries.slice(-this.maxEntries);
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify({ entries: capped }, null, 2));
    }).catch(() => {});

    return this.writeQueue;
  }
}
