import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const HARNESS_DIR = join(APP_DIR, '.harness');
export const CURRENT_SESSION_PATH = join(HARNESS_DIR, 'current-session.json');
export const DIST_MAIN = join(APP_DIR, 'dist', 'main', 'index.js');
export const DIST_RENDERER = join(APP_DIR, 'dist', 'renderer', 'index.html');
export const STORE_RELATIVE_DIR = join('.pulse-coder', 'canvas');
export const DEFAULT_TIMEOUT_MS = 30_000;
