import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PreferencesStore } from './preferences.js';

describe('PreferencesStore', () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulse-prefs-'));
    filePath = path.join(dir, 'preferences.json');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('returns empty preferences when the file is missing or malformed', async () => {
    const store = new PreferencesStore(filePath);
    expect(await store.load()).toEqual({});

    await fs.writeFile(filePath, 'not json');
    expect(await store.load()).toEqual({});
  });

  it('round-trips the last model and merges successive updates', async () => {
    const store = new PreferencesStore(filePath);
    await store.update({ lastModel: 'deepseek:deepseek-v4-flash' });
    expect(await store.load()).toEqual({ lastModel: 'deepseek:deepseek-v4-flash' });

    await store.update({ lastModel: 'claude:claude-opus-5' });
    expect(await store.load()).toEqual({ lastModel: 'claude:claude-opus-5' });
  });

  it('clears the stored model when passed null (i.e. /model reset)', async () => {
    const store = new PreferencesStore(filePath);
    await store.update({ lastModel: 'gpt-5.2' });
    await store.update({ lastModel: null });
    expect(await store.load()).toEqual({});
  });

  it('ignores blank values', async () => {
    const store = new PreferencesStore(filePath);
    await store.update({ lastModel: '   ' });
    expect(await store.load()).toEqual({});
  });
});
