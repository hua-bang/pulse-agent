#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluatePackageGates } from './package-gates.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const releaseDir = join(appRoot, 'release');
const packageJson = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf-8'));
const appPath = join(releaseDir, 'mac-arm64/Pulse Canvas.app');
const dmgPath = join(releaseDir, `Pulse Canvas-${packageJson.version}-arm64.dmg`);
const resourcesPath = join(appPath, 'Contents/Resources');
const asarPath = join(resourcesPath, 'app.asar');
const unpackedPath = join(resourcesPath, 'app.asar.unpacked');
const electronResourcesPath = join(
  appPath,
  'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources',
);
const outPath = join(appRoot, 'perf/out/package-report.json');
const baselinesPath = join(appRoot, 'perf/baselines.json');

const recursiveBytes = (path) => {
  if (!existsSync(path)) return 0;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return stat.size;
  if (!stat.isDirectory()) return stat.size;
  return readdirSync(path).reduce((total, entry) => total + recursiveBytes(join(path, entry)), 0);
};

const mib = (bytes) => Math.round((bytes / (1024 * 1024)) * 10) / 10;
const mb = (bytes) => Math.round((bytes / 1_000_000) * 10) / 10;

if (!existsSync(appPath) || !existsSync(dmgPath)) {
  console.error('[perf:package] missing arm64 release; run pnpm --filter canvas-workspace package:mac:arm64');
  process.exit(2);
}

let commit = 'unknown';
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: appRoot,
    encoding: 'utf-8',
  }).trim();
} catch {
  // A packaged source export may not have Git metadata.
}

const localeNames = existsSync(electronResourcesPath)
  ? readdirSync(electronResourcesPath).filter((name) => name.endsWith('.lproj'))
  : [];
const report = {
  generatedAt: new Date().toISOString(),
  commit,
  platform: 'darwin',
  arch: 'arm64',
  metrics: {
    dmgMB: mb(statSync(dmgPath).size),
    appUnpackedMiB: mib(recursiveBytes(appPath)),
    asarMiB: mib(statSync(asarPath).size),
    nativeUnpackedMiB: mib(recursiveBytes(unpackedPath)),
    electronLocaleCount: localeNames.length,
  },
  localeNames,
};
report.gates = evaluatePackageGates(
  report.metrics,
  JSON.parse(readFileSync(baselinesPath, 'utf-8')),
);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`[perf:package] DMG ${report.metrics.dmgMB} MB · app ${report.metrics.appUnpackedMiB} MiB · ASAR ${report.metrics.asarMiB} MiB · unpacked ${report.metrics.nativeUnpackedMiB} MiB · locales ${localeNames.length}`);
for (const gate of report.gates) {
  console.log(
    `[perf:package] ${gate.pass ? 'PASS' : 'FAIL'} ${gate.metric}: ${gate.value}`
    + ` (${gate.operator ?? 'missing'} ${gate.limit ?? 'missing'})`,
  );
}
console.log('[perf:package] report: perf/out/package-report.json');
if (report.gates.some((gate) => !gate.pass)) process.exitCode = 1;
