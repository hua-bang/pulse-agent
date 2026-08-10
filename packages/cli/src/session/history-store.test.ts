import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PromptHistoryStore } from './history-store.js';

describe('PromptHistoryStore', () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulse-history-'));
    filePath = path.join(dir, 'history.json');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('returns an empty list when the file does not exist or is invalid', async () => {
    const store = new PromptHistoryStore(filePath);
    expect(await store.load()).toEqual([]);

    await fs.writeFile(filePath, 'not json');
    expect(await store.load()).toEqual([]);
  });

  it('appends entries and loads them back in order', async () => {
    const store = new PromptHistoryStore(filePath);
    await store.append('first');
    await store.append('second');

    expect(await store.load()).toEqual(['first', 'second']);
  });

  it('skips blanks and consecutive duplicates', async () => {
    const store = new PromptHistoryStore(filePath);
    await store.append('same');
    await store.append('   ');
    await store.append('same');
    await store.append('other');

    expect(await store.load()).toEqual(['same', 'other']);
  });

  it('caps stored entries at maxEntries', async () => {
    const store = new PromptHistoryStore(filePath, 2);
    await store.append('a');
    await store.append('b');
    await store.append('c');

    expect(await store.load()).toEqual(['b', 'c']);
  });
});
