import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';

export interface CliPreferences {
  /** Last model spec chosen via /model or --model, e.g. "deepseek:deepseek-v4-flash". */
  lastModel?: string;
}

/**
 * Small user-level preference store (`~/.pulse-coder/preferences.json`).
 * Deliberately separate from models.json: that file declares what is
 * *available* and is committable, this one records what you last *chose* and
 * is machine-local.
 */
export class PreferencesStore {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath = path.join(homedir(), '.pulse-coder', 'preferences.json')) {}

  async load(): Promise<CliPreferences> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as CliPreferences;
      if (!parsed || typeof parsed !== 'object') {
        return {};
      }
      return {
        ...(typeof parsed.lastModel === 'string' && parsed.lastModel.trim()
          ? { lastModel: parsed.lastModel.trim() }
          : {}),
      };
    } catch {
      return {};
    }
  }

  /** Merges a patch into the stored preferences; `null` clears a field. */
  update(patch: { lastModel?: string | null }): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      const current = await this.load();
      const next: CliPreferences = { ...current };

      if (patch.lastModel === null) {
        delete next.lastModel;
      } else if (typeof patch.lastModel === 'string' && patch.lastModel.trim()) {
        next.lastModel = patch.lastModel.trim();
      }

      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(next, null, 2));
    }).catch(() => {});

    return this.writeQueue;
  }
}
