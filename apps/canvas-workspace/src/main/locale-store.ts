/**
 * Persisted UI-locale store.
 *
 * Persists the user's chosen locale at
 * `~/.pulse-coder/canvas/locale.json` (override the path with
 * `PULSE_CANVAS_LOCALE_FILE`). Exposes both a sync read (for the
 * sandboxed preload, which can't touch the filesystem itself) and an
 * async read/write pair (used by the IPC handlers + main-process `t()`).
 *
 * On first run — when no file exists — falls back to `app.getLocale()` so
 * users running a zh-CN OS get a Chinese UI without a manual toggle.
 */

import { app } from 'electron';
import { promises as fs, readFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  normaliseLocale,
  type SupportedLocale,
} from '../shared/locales';

function getLocaleFilePath(): string {
  const override = process.env.PULSE_CANVAS_LOCALE_FILE?.trim();
  return override || join(homedir(), '.pulse-coder', 'canvas', 'locale.json');
}

let cachedLocale: SupportedLocale | null = null;

function defaultLocaleFromOS(): SupportedLocale {
  try {
    return normaliseLocale(app.getLocale());
  } catch {
    return DEFAULT_LOCALE;
  }
}

function parseLocale(raw: string): SupportedLocale | null {
  try {
    const parsed = JSON.parse(raw) as { locale?: unknown };
    if (parsed && isSupportedLocale(parsed.locale)) return parsed.locale;
  } catch {
    /* swallow — caller falls back to OS default */
  }
  return null;
}

export function readLocaleSync(): SupportedLocale {
  if (cachedLocale) return cachedLocale;
  try {
    const raw = readFileSync(getLocaleFilePath(), 'utf8');
    cachedLocale = parseLocale(raw) ?? defaultLocaleFromOS();
  } catch {
    cachedLocale = defaultLocaleFromOS();
  }
  return cachedLocale;
}

export async function readLocale(): Promise<SupportedLocale> {
  if (cachedLocale) return cachedLocale;
  try {
    const raw = await fs.readFile(getLocaleFilePath(), 'utf8');
    cachedLocale = parseLocale(raw) ?? defaultLocaleFromOS();
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code !== 'ENOENT') throw err;
    cachedLocale = defaultLocaleFromOS();
  }
  return cachedLocale;
}

export async function writeLocale(locale: SupportedLocale): Promise<void> {
  const path = getLocaleFilePath();
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, `${JSON.stringify({ locale }, null, 2)}\n`, 'utf8');
  cachedLocale = locale;
}

/** Test-only — clears the in-memory cache so the next read goes to disk. */
export function __resetLocaleCacheForTests(): void {
  cachedLocale = null;
}
