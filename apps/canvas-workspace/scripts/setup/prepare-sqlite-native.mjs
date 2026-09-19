import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cp, copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const appRoot = fileURLToPath(new URL('../..', import.meta.url));
const cliRoot = resolve(appRoot, '../../packages/canvas-cli');

function inspectBinding(electronPath, sqliteRoot, nativeBinding) {
  const script = `
    const Database = require(${JSON.stringify(sqliteRoot)});
    const db = new Database(':memory:', { nativeBinding: ${JSON.stringify(nativeBinding)} });
    console.log(JSON.stringify({
      modules: process.versions.modules,
      sqliteVersion: db.prepare('SELECT sqlite_version() AS version').get().version,
    }));
    db.close();
  `;
  return JSON.parse(execFileSync(electronPath, ['-e', script], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    timeout: 30_000,
  }));
}

/** Package only the current Electron ABI; keep the development CLI's multi-ABI tree intact. */
export async function stagePackagedNative(
  source,
  nativeName,
  outputDir = join(appRoot, 'node_modules', '.cache', 'pulse-sqlite', 'package-native'),
) {
  if (!/^[a-z0-9_]+-[a-z0-9_]+-[0-9]+\.node$/.test(nativeName)) {
    throw new Error(`Invalid SQLite native payload name: ${nativeName}`);
  }
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  const output = join(outputDir, nativeName);
  await copyFile(source, output);
  return output;
}

/** Only the copied package under temporary staging is ever rebuilt. */
export async function prepareElectronNative() {
  const appRequire = createRequire(join(appRoot, 'package.json'));
  const cliRequire = createRequire(join(cliRoot, 'package.json'));
  const electronPath = appRequire('electron');
  const electronVersion = appRequire('electron/package.json').version;
  const sqliteRoot = dirname(cliRequire.resolve('better-sqlite3/package.json'));
  const driverVersion = cliRequire('better-sqlite3/package.json').version;
  const runtime = JSON.parse(execFileSync(electronPath, ['-e', 'console.log(JSON.stringify(process.versions))'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    timeout: 30_000,
  }));
  const nativeName = `${process.platform}-${process.arch}-${runtime.modules}.node`;
  const cacheDir = join(appRoot, 'node_modules', '.cache', 'pulse-sqlite', driverVersion, electronVersion);
  const cachedBinding = join(cacheDir, nativeName);
  const outputDir = join(cliRoot, 'dist', 'native');
  const output = join(outputDir, nativeName);
  try {
    const inspected = inspectBinding(electronPath, sqliteRoot, cachedBinding);
    await mkdir(outputDir, { recursive: true });
    await copyFile(cachedBinding, output);
    const packageOutput = await stagePackagedNative(cachedBinding, nativeName);
    return { output, packageOutput, ...inspected };
  } catch {
    // A missing or unloadable cache is rebuilt from the installed package.
  }

  const installedBinding = join(sqliteRoot, 'build', 'Release', 'better_sqlite3.node');
  const before = createHash('sha256').update(await readFile(installedBinding)).digest('hex');
  const staging = await mkdtemp(join(tmpdir(), 'pulse-electron-sqlite-'));
  try {
    const copiedRoot = join(staging, 'node_modules', 'better-sqlite3');
    await mkdir(dirname(copiedRoot), { recursive: true });
    await cp(sqliteRoot, copiedRoot, { recursive: true, dereference: true });
    await writeFile(join(staging, 'package.json'), JSON.stringify({
      private: true,
      dependencies: { 'better-sqlite3': driverVersion },
    }));
    const { rebuild } = await import(pathToFileURL(appRequire.resolve('@electron/rebuild')).href);
    await rebuild({
      buildPath: staging,
      electronVersion,
      arch: process.arch,
      onlyModules: ['better-sqlite3'],
      force: true,
      buildFromSource: true,
    });
    const rebuilt = join(copiedRoot, 'build', 'Release', 'better_sqlite3.node');
    const inspected = inspectBinding(electronPath, sqliteRoot, rebuilt);
    await mkdir(cacheDir, { recursive: true });
    const temporaryCache = `${cachedBinding}.${randomUUID()}`;
    await copyFile(rebuilt, temporaryCache);
    await rename(temporaryCache, cachedBinding);
    await mkdir(outputDir, { recursive: true });
    await copyFile(rebuilt, output);
    const packageOutput = await stagePackagedNative(rebuilt, nativeName);
    return { output, packageOutput, ...inspected };
  } finally {
    await rm(staging, { recursive: true, force: true });
    const after = createHash('sha256').update(await readFile(installedBinding)).digest('hex');
    if (before !== after) throw new Error('Electron preparation modified the shared Node SQLite binding');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await prepareElectronNative();
  console.log(`SQLite ${result.sqliteVersion}: prepared Electron binding ${result.output}`);
}
