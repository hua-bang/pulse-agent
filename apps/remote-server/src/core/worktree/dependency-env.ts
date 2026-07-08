import { homedir } from 'os';
import { join } from 'path';

const DEFAULT_PNPM_STORE_DIR = join(homedir(), '.local', 'share', 'pnpm', 'store');
const DEFAULT_NPM_CACHE_DIR = join(homedir(), '.npm');
const DEFAULT_XDG_CACHE_HOME = join(homedir(), '.cache');

/**
 * Shared dependency caches keep per-worktree installs from copying heavy
 * package payloads while preserving each worktree's own workspace links.
 */
export function buildSharedDependencyEnv(baseEnv: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const xdgCacheHome = envValue(baseEnv, 'XDG_CACHE_HOME', DEFAULT_XDG_CACHE_HOME);
  return {
    npm_config_store_dir: envValue(baseEnv, 'npm_config_store_dir', envValue(baseEnv, 'PNPM_STORE_DIR', DEFAULT_PNPM_STORE_DIR)),
    npm_config_package_import_method: envValue(baseEnv, 'npm_config_package_import_method', 'hardlink'),
    npm_config_cache: envValue(baseEnv, 'npm_config_cache', DEFAULT_NPM_CACHE_DIR),
    XDG_CACHE_HOME: xdgCacheHome,
    ELECTRON_CACHE: envValue(baseEnv, 'ELECTRON_CACHE', join(xdgCacheHome, 'electron')),
    PLAYWRIGHT_BROWSERS_PATH: envValue(baseEnv, 'PLAYWRIGHT_BROWSERS_PATH', join(xdgCacheHome, 'ms-playwright')),
    PUPPETEER_CACHE_DIR: envValue(baseEnv, 'PUPPETEER_CACHE_DIR', join(xdgCacheHome, 'puppeteer')),
  };
}

function envValue(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = env[key]?.trim();
  return value || fallback;
}
