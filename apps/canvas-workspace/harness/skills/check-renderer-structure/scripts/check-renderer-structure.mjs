#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultAppRoot = resolve(scriptDir, '../../../..');
const SHARED_COMPONENT_GROUPS = new Set(['ui', 'icons', 'feedback']);
const LEGACY_FEATURE_ROOT_NAMES = new Set(['agent-chat', 'editor', 'views']);
const CODE_EXTENSIONS = new Set(['.ts', '.tsx']);

const normalize = (value) => value.split(sep).join('/');
const countLines = (text) => {
  if (text.length === 0) return 0;
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return normalized.split('\n').length - (normalized.endsWith('\n') ? 1 : 0);
};
const isTestFile = (path) => path.includes('/__tests__/') || /\.test\.[cm]?[jt]sx?$/.test(path);

const walkFiles = (root, directory = root) => readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return walkFiles(root, path);
    return [{ absolutePath: path, path: normalize(relative(root, path)) }];
  });

const childDirectories = (path) => existsSync(path)
  ? readdirSync(path, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
  : [];

const importSpecifiers = (source) => {
  const matches = [];
  const pattern = /(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;
  let match;
  while ((match = pattern.exec(source)) !== null) matches.push(match[1]);
  return matches;
};

const resolvedRelativeImport = (rendererRoot, sourcePath, specifier) => {
  if (!specifier.startsWith('.')) return null;
  return normalize(relative(rendererRoot, resolve(dirname(resolve(rendererRoot, sourcePath)), specifier)));
};

const moduleOwner = (path) => {
  const parts = path.split('/');
  return parts[0] === 'modules' ? parts[1] : undefined;
};

const canonicalCycle = (cycle) => {
  const nodes = cycle.slice(0, -1);
  const rotations = nodes.map((_, index) => [...nodes.slice(index), ...nodes.slice(0, index)]);
  const canonical = rotations.map(parts => parts.join(' -> ')).sort()[0];
  return `${canonical} -> ${canonical.split(' -> ')[0]}`;
};

const findModuleCycles = (edges) => {
  const cycles = new Set();
  const visit = (start, current, path) => {
    for (const next of edges.get(current) ?? []) {
      if (next === start && path.length > 1) {
        cycles.add(canonicalCycle([...path, start]));
      } else if (!path.includes(next)) {
        visit(start, next, [...path, next]);
      }
    }
  };
  for (const owner of edges.keys()) visit(owner, owner, [owner]);
  return [...cycles].sort();
};

const analyzeDependencyDirection = (rendererRoot, productionFiles) => {
  const errors = [];
  const edges = new Map();
  for (const file of productionFiles) {
    const sourceRoot = file.path.split('/')[0];
    const sourceOwner = moduleOwner(file.path);
    const source = readFileSync(file.absolutePath, 'utf8');
    for (const specifier of importSpecifiers(source)) {
      const target = resolvedRelativeImport(rendererRoot, file.path, specifier);
      if (!target) continue;
      const targetParts = target.split('/');
      const targetRoot = targetParts[0];
      const targetOwner = moduleOwner(target);

      if (sourceOwner && targetOwner && sourceOwner !== targetOwner) {
        const targets = edges.get(sourceOwner) ?? new Set();
        targets.add(targetOwner);
        edges.set(sourceOwner, targets);
      }

      if (sourceRoot === 'modules' && targetRoot === 'app') {
        errors.push({ file: file.path, import: specifier, reason: 'module imports app' });
      }
      if (
        sourceRoot === 'components'
        && SHARED_COMPONENT_GROUPS.has(file.path.split('/')[1])
        && targetRoot === 'modules'
      ) {
        errors.push({ file: file.path, import: specifier, reason: 'shared component imports product module' });
      }
      if (sourceRoot === 'shared' && ['app', 'modules', 'components', 'platform'].includes(targetRoot)) {
        errors.push({ file: file.path, import: specifier, reason: `shared imports ${targetRoot}` });
      }
      if (sourceRoot === 'platform' && ['app', 'modules', 'components'].includes(targetRoot)) {
        errors.push({ file: file.path, import: specifier, reason: `platform imports ${targetRoot}` });
      }
      if (sourceOwner && targetOwner && sourceOwner !== targetOwner && targetParts.length > 2) {
        const remaining = targetParts.slice(2).join('/');
        const isRootEntryFile = !remaining.includes('/') && ['.ts', '.tsx'].some(
          extension => existsSync(`${resolve(rendererRoot, target)}${extension}`),
        );
        if (!/^index(?:\.[cm]?[jt]sx?)?$/.test(remaining) && !isRootEntryFile) {
          errors.push({
            file: file.path,
            import: specifier,
            reason: `cross-module internal import (${sourceOwner} -> ${targetOwner})`,
          });
        }
      }
    }
  }
  return { errors, cycles: findModuleCycles(edges) };
};

export const analyzeRendererStructure = (rendererRoot) => {
  if (!existsSync(rendererRoot)) throw new Error(`renderer root not found: ${rendererRoot}`);
  const files = walkFiles(rendererRoot);
  const productionFiles = files.filter(file => CODE_EXTENSIONS.has(extname(file.path)) && !isTestFile(`/${file.path}`));
  const topLevelDirectories = childDirectories(rendererRoot);
  const componentGroups = childDirectories(resolve(rendererRoot, 'components'));
  const businessComponentGroups = componentGroups.filter(group => !SHARED_COMPONENT_GROUPS.has(group));
  const legacyFeatureRoots = topLevelDirectories.filter(name => LEGACY_FEATURE_ROOT_NAMES.has(name));

  const flatComponentFiles = productionFiles
    .filter((file) => {
      const parts = file.path.split('/');
      if (parts.length !== 3 || parts[0] !== 'components' || extname(file.path) !== '.tsx') return false;
      if (SHARED_COMPONENT_GROUPS.has(parts[1])) return false;
      if (['index.tsx', 'lazy.tsx'].includes(parts[2])) return false;
      return countLines(readFileSync(file.absolutePath, 'utf8')) > 120;
    })
    .map(file => file.path)
    .sort();

  const codeOver500 = productionFiles
    .map(file => ({ path: file.path, lines: countLines(readFileSync(file.absolutePath, 'utf8')) }))
    .filter(file => file.lines > 500)
    .sort((a, b) => b.lines - a.lines);

  const visualOver300 = productionFiles
    .filter(file => extname(file.path) === '.tsx' && (
      /^(components|views)\//.test(file.path)
      || /^modules\/[^/]+\/(components|views)\//.test(file.path)
    ))
    .filter(file => !/^use[A-Z]/.test(file.path.split('/').pop() ?? ''))
    .map(file => ({ path: file.path, lines: countLines(readFileSync(file.absolutePath, 'utf8')) }))
    .filter(file => file.lines > 300)
    .sort((a, b) => b.lines - a.lines);

  const cssOver500 = files
    .filter(file => extname(file.path) === '.css')
    .map(file => ({ path: file.path, lines: countLines(readFileSync(file.absolutePath, 'utf8')) }))
    .filter(file => file.lines > 500)
    .sort((a, b) => b.lines - a.lines);

  const separatedStyles = productionFiles
    .filter(file => file.path.endsWith('/index.tsx'))
    .flatMap((file) => {
      const source = readFileSync(file.absolutePath, 'utf8');
      return importSpecifiers(source)
        .filter(specifier => specifier.endsWith('.css') && specifier.startsWith('../'))
        .map(specifier => ({ file: file.path, import: specifier }));
    });

  const centralTests = files
    .filter(file => /^components\/[^/]+\/__tests__\//.test(file.path))
    .filter(file => !SHARED_COMPONENT_GROUPS.has(file.path.split('/')[1]))
    .map(file => file.path)
    .sort();

  const dependency = analyzeDependencyDirection(rendererRoot, productionFiles);
  const boundaryErrors = dependency.errors;
  const moduleCycles = dependency.cycles;
  const modulesPresent = topLevelDirectories.includes('modules');
  const targetGapCount = Number(!modulesPresent)
    + businessComponentGroups.length
    + legacyFeatureRoots.length
    + flatComponentFiles.length
    + boundaryErrors.length
    + moduleCycles.length;

  return {
    rendererRoot: normalize(rendererRoot),
    mode: modulesPresent ? 'module-first-migration' : 'legacy-migration',
    topLevelDirectories,
    componentGroups,
    modules: childDirectories(resolve(rendererRoot, 'modules')),
    businessComponentGroups,
    legacyFeatureRoots,
    flatComponentFiles,
    separatedStyles,
    centralTests,
    boundaryErrors,
    moduleCycles,
    boundaryCoverage: {
      modulesPresent,
      relativeImportsChecked: true,
      note: modulesPresent
        ? 'module direction and cycles checked for relative imports'
        : 'modules/ is absent; module direction and cycle checks are not yet applicable',
    },
    pressure: { codeOver500, visualOver300, cssOver500 },
    summary: {
      productionCodeFiles: productionFiles.length,
      businessComponentGroupCount: businessComponentGroups.length,
      flatComponentFileCount: flatComponentFiles.length,
      boundaryErrorCount: boundaryErrors.length,
      moduleCycleCount: moduleCycles.length,
      targetGapCount,
    },
  };
};

const list = (items, format, limit = 12) => items.length === 0
  ? '  none'
  : items.slice(0, limit).map(item => `  - ${format(item)}`).join('\n')
    + (items.length > limit ? `\n  ... ${items.length - limit} more` : '');

export const renderRendererStructureReport = (report) => [
  `Renderer structure health (${report.mode})`,
  `root: ${report.rendererRoot}`,
  '',
  `summary: ${report.summary.productionCodeFiles} production code files · ${report.summary.targetGapCount} target gaps · ${report.summary.boundaryErrorCount} boundary errors · ${report.summary.moduleCycleCount} module cycles`,
  `top-level: ${report.topLevelDirectories.join(', ')}`,
  `modules: ${report.modules.length ? report.modules.join(', ') : '(not established)'}`,
  '',
  `business component groups (${report.businessComponentGroups.length}):`,
  list(report.businessComponentGroups, value => value),
  `legacy feature roots (${report.legacyFeatureRoots.length}):`,
  list(report.legacyFeatureRoots, value => value),
  `flat component files (${report.flatComponentFiles.length}):`,
  list(report.flatComponentFiles, value => value),
  `cross-owner CSS imports (${report.separatedStyles.length}):`,
  list(report.separatedStyles, value => `${value.file} -> ${value.import}`),
  `central tests to classify (${report.centralTests.length}):`,
  list(report.centralTests, value => value),
  `dependency direction errors (${report.boundaryErrors.length}):`,
  list(report.boundaryErrors, value => `${value.file}: ${value.reason} via ${value.import}`),
  `module cycles (${report.moduleCycles.length}):`,
  list(report.moduleCycles, value => value),
  `boundary coverage: ${report.boundaryCoverage.note}`,
  '',
  `code >500 (${report.pressure.codeOver500.length}):`,
  list(report.pressure.codeOver500, value => `${value.lines} ${value.path}`),
  `visual TSX >300 (${report.pressure.visualOver300.length}):`,
  list(report.pressure.visualOver300, value => `${value.lines} ${value.path}`),
  `CSS >500 (${report.pressure.cssOver500.length}):`,
  list(report.pressure.cssOver500, value => `${value.lines} ${value.path}`),
].join('\n');

const parseArgs = (argv) => {
  const result = { json: false, strict: false, appRoot: defaultAppRoot };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') result.json = true;
    else if (arg === '--strict') result.strict = true;
    else if (arg === '--app-root') result.appRoot = resolve(argv[++index]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return result;
};

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  const rendererRoot = resolve(options.appRoot, 'src/renderer/src');
  const report = analyzeRendererStructure(rendererRoot);
  console.log(options.json ? JSON.stringify(report, null, 2) : renderRendererStructureReport(report));
  if (options.strict && report.summary.targetGapCount > 0) process.exitCode = 1;
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
