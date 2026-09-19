import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));

/** Copy the installed Node binding; never rebuild a shared pnpm dependency. */
export async function prepareNodeNative(outputDir = join(packageRoot, 'dist', 'native')) {
  const require = createRequire(join(packageRoot, 'package.json'));
  const sqliteRoot = dirname(require.resolve('better-sqlite3/package.json'));
  const binding = join(sqliteRoot, 'build', 'Release', 'better_sqlite3.node');
  const Database = require('better-sqlite3');
  const database = new Database(':memory:', { nativeBinding: binding });
  let sqliteVersion;
  try {
    sqliteVersion = database.prepare('SELECT sqlite_version() AS version').get().version;
  } finally {
    database.close();
  }
  await mkdir(outputDir, { recursive: true });
  const destination = join(outputDir, `${process.platform}-${process.arch}-${process.versions.modules}.node`);
  await copyFile(binding, destination);
  return { destination, sqliteVersion };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { destination, sqliteVersion } = await prepareNodeNative();
  console.log(`SQLite ${sqliteVersion}: prepared Node binding ${destination}`);
}
