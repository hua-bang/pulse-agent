import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// `app` is only reached when no override locale is present on disk; tests
// either write a value first or assert only that the fallback is a
// supported value, so a stub is sufficient.
vi.mock('electron', () => ({
  app: { getLocale: () => 'en-US' },
}));

const { __resetLocaleCacheForTests, readLocale, readLocaleSync, writeLocale } = await import(
  '../locale-store'
);

let workDir: string;
let prevEnv: string | undefined;

beforeEach(async () => {
  workDir = await fs.mkdtemp(join(tmpdir(), 'canvas-locale-'));
  prevEnv = process.env.PULSE_CANVAS_LOCALE_FILE;
  process.env.PULSE_CANVAS_LOCALE_FILE = join(workDir, 'locale.json');
  __resetLocaleCacheForTests();
});

afterEach(async () => {
  if (prevEnv === undefined) delete process.env.PULSE_CANVAS_LOCALE_FILE;
  else process.env.PULSE_CANVAS_LOCALE_FILE = prevEnv;
  __resetLocaleCacheForTests();
  await fs.rm(workDir, { recursive: true, force: true });
});

describe('locale-store', () => {
  it('writes and reads a supported locale round-trip', async () => {
    await writeLocale('zh');
    __resetLocaleCacheForTests();
    expect(await readLocale()).toBe('zh');
    __resetLocaleCacheForTests();
    expect(readLocaleSync()).toBe('zh');
  });

  it('falls back to default when the file is missing', async () => {
    expect(await readLocale()).toMatch(/^(en|zh)$/);
  });

  it('falls back to default when the file is malformed JSON', async () => {
    await fs.writeFile(process.env.PULSE_CANVAS_LOCALE_FILE!, '{not json');
    expect(await readLocale()).toMatch(/^(en|zh)$/);
  });

  it('falls back to default when the persisted locale is unsupported', async () => {
    await fs.writeFile(
      process.env.PULSE_CANVAS_LOCALE_FILE!,
      JSON.stringify({ locale: 'fr' }),
    );
    expect(await readLocale()).toMatch(/^(en|zh)$/);
  });

  it('caches the value so subsequent reads avoid disk I/O', async () => {
    await writeLocale('zh');
    expect(readLocaleSync()).toBe('zh');
    // Mutate the file behind the cache — cached value should still win.
    await fs.writeFile(
      process.env.PULSE_CANVAS_LOCALE_FILE!,
      JSON.stringify({ locale: 'en' }),
    );
    expect(readLocaleSync()).toBe('zh');
    __resetLocaleCacheForTests();
    expect(readLocaleSync()).toBe('en');
  });
});
