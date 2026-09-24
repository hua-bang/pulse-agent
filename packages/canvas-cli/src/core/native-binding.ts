import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

export interface SqliteNativeRuntime {
  platform: string;
  arch: string;
  modules: string;
  electron?: string;
}

/** Resolve the bundle's exact ABI, with an installed Node dependency fallback. */
export function resolveSqliteNativeBinding(
  entryDirectory = __dirname,
  runtime: SqliteNativeRuntime = {
    platform: process.platform,
    arch: process.arch,
    modules: process.versions.modules,
    electron: process.versions.electron,
  },
): string {
  const name = `${runtime.platform}-${runtime.arch}-${runtime.modules}.node`;
  const candidates = [
    join(entryDirectory, 'native', name),
    join(entryDirectory, '..', 'native', name),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return resolve(candidate);
  }

  // Electron must use its isolated build, never the pnpm Node ABI binary.
  if (!runtime.electron) {
    try {
      const require = createRequire(join(entryDirectory, 'package.json'));
      const installedRoot = dirname(require.resolve('better-sqlite3/package.json'));
      const binding = join(installedRoot, 'build', 'Release', 'better_sqlite3.node');
      if (existsSync(binding)) return binding;
    } catch {
      // The managed bundle intentionally has no node_modules directory.
    }
  }
  throw new Error(
    `SQLite native binding missing for ${runtime.platform}/${runtime.arch} ABI ${runtime.modules}`
    + (runtime.electron ? ` (Electron ${runtime.electron})` : ' (Node)')
    + '. Rebuild the CLI or repair Pulse Canvas agent tooling.',
  );
}
