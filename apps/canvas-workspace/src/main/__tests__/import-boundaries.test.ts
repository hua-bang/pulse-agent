import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import * as ts from 'typescript';
import { describe, it } from 'vitest';

const REPO_ROOT = process.cwd();
const SRC_ROOT = join(REPO_ROOT, 'src');

type SourceSurface = 'shared' | 'renderer' | 'main' | 'preload';

type TargetSurface =
  | SourceSurface
  | 'plugins-contract'
  | 'plugins-other'
  | 'node-runtime'
  | 'electron'
  | 'external'
  | 'unknown';

interface ImportRef {
  sourceFile: string;
  line: number;
  specifier: string;
  kind: 'import' | 'export' | 'dynamic-import' | 'require';
}

interface ResolvedImport extends ImportRef {
  sourceSurface: SourceSurface;
  targetSurface: TargetSurface;
  targetPath?: string;
}

interface BoundaryViolation {
  imported: ResolvedImport;
  rule: string;
  message: string;
}

const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

const PRELOAD_SHARED_CONTRACT_MIGRATION =
  'Known bridge type debt: cross-process API contracts still live in ' +
  'src/renderer/src/types.ts. Move these contracts to src/shared/*, then ' +
  'replace the preload imports and delete the allowlist entry.';

const allowPreloadImport = (sourceFile: string, specifier: string): string =>
  `${sourceFile} -> ${specifier}`;

const ALLOWED_PRELOAD_BOUNDARY_IMPORTS = new Map<string, string>([
  // Shared-contract migration path: move CanvasWorkspaceApi and API group
  // interfaces from renderer/src/types.ts into src/shared/*, then remove these
  // preload -> renderer exceptions one by one.
  [
    allowPreloadImport('src/preload/index.ts', '../renderer/src/types'),
    PRELOAD_SHARED_CONTRACT_MIGRATION,
  ],
  [
    allowPreloadImport('src/preload/bridge/agent.ts', '../../renderer/src/types'),
    PRELOAD_SHARED_CONTRACT_MIGRATION,
  ],
  [
    allowPreloadImport('src/preload/bridge/agent-teams.ts', '../../renderer/src/types'),
    PRELOAD_SHARED_CONTRACT_MIGRATION,
  ],
  [
    allowPreloadImport('src/preload/bridge/app-info.ts', '../../renderer/src/types'),
    PRELOAD_SHARED_CONTRACT_MIGRATION,
  ],
  [
    allowPreloadImport('src/preload/bridge/artifacts.ts', '../../renderer/src/types'),
    PRELOAD_SHARED_CONTRACT_MIGRATION,
  ],
  [
    allowPreloadImport('src/preload/bridge/codex-sessions.ts', '../../renderer/src/types'),
    PRELOAD_SHARED_CONTRACT_MIGRATION,
  ],
  [
    allowPreloadImport('src/preload/bridge/file.ts', '../../renderer/src/types'),
    PRELOAD_SHARED_CONTRACT_MIGRATION,
  ],
  [
    allowPreloadImport('src/preload/bridge/pty.ts', '../../renderer/src/types'),
    PRELOAD_SHARED_CONTRACT_MIGRATION,
  ],
  [
    allowPreloadImport('src/preload/bridge/settings.ts', '../../renderer/src/types'),
    PRELOAD_SHARED_CONTRACT_MIGRATION,
  ],
  [
    allowPreloadImport('src/preload/bridge/store.ts', '../../renderer/src/types'),
    PRELOAD_SHARED_CONTRACT_MIGRATION,
  ],
  [
    allowPreloadImport('src/preload/bridge/webview.ts', '../../renderer/src/types'),
    PRELOAD_SHARED_CONTRACT_MIGRATION,
  ],
  [
    allowPreloadImport('src/preload/bridge/workspace-nodes.ts', '../../renderer/src/types'),
    PRELOAD_SHARED_CONTRACT_MIGRATION,
  ],
]);

describe('import boundaries', () => {
  it('keeps shared, renderer, main, and preload imports inside their allowed layers', () => {
    const imports = findSourceFiles(SRC_ROOT).flatMap(readImports);
    const resolved = imports.flatMap(resolveImport);
    const usedAllowlistEntries = new Set<string>();
    const violations: BoundaryViolation[] = [];

    for (const imported of resolved) {
      const violation = checkBoundary(imported);
      if (!violation) continue;

      const allowlistKey = allowPreloadImport(imported.sourceFile, imported.specifier);
      if (
        imported.sourceSurface === 'preload' &&
        ALLOWED_PRELOAD_BOUNDARY_IMPORTS.has(allowlistKey)
      ) {
        usedAllowlistEntries.add(allowlistKey);
        continue;
      }

      violations.push(violation);
    }

    const staleAllowlistEntries = Array.from(ALLOWED_PRELOAD_BOUNDARY_IMPORTS.keys())
      .filter((key) => !usedAllowlistEntries.has(key));

    if (violations.length > 0 || staleAllowlistEntries.length > 0) {
      throw new Error(formatFailure(violations, staleAllowlistEntries));
    }
  });
});

function findSourceFiles(root: string): string[] {
  const files: string[] = [];

  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
        // Test files run under vitest's node environment, never inside a
        // real process surface, so the boundary contract does not govern
        // them (e.g. a renderer unit test may read its CSS via node:fs).
        // Same exclusion the file-size and ui-reuse suites apply.
        if (/\.test\.(ts|tsx)$/.test(entry.name) || path.includes(`${sep}__tests__${sep}`)) {
          continue;
        }
        files.push(path);
      }
    }
  };

  visit(root);
  return files.sort();
}

function readImports(filePath: string): ImportRef[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const repoPath = toRepoPath(filePath);
  const imports: ImportRef[] = [];

  const addImport = (
    moduleSpecifier: ts.StringLiteralLike,
    kind: ImportRef['kind'],
  ): void => {
    const position = sourceFile.getLineAndCharacterOfPosition(
      moduleSpecifier.getStart(sourceFile),
    );
    imports.push({
      sourceFile: repoPath,
      line: position.line + 1,
      specifier: moduleSpecifier.text,
      kind,
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      addImport(node.moduleSpecifier, 'import');
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      addImport(node.moduleSpecifier, 'export');
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      addImport(node.moduleReference.expression, 'import');
    } else if (ts.isCallExpression(node)) {
      const [firstArg] = node.arguments;
      if (firstArg && ts.isStringLiteralLike(firstArg)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          addImport(firstArg, 'dynamic-import');
        } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
          addImport(firstArg, 'require');
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return imports;
}

function resolveImport(imported: ImportRef): ResolvedImport[] {
  const sourceSurface = classifySourceSurface(imported.sourceFile);
  if (!sourceSurface) return [];

  const target = classifyTarget(imported);
  return [{ ...imported, sourceSurface, ...target }];
}

function classifySourceSurface(repoPath: string): SourceSurface | null {
  if (repoPath.startsWith('src/shared/')) return 'shared';
  if (repoPath.startsWith('src/preload/')) return 'preload';
  if (
    repoPath.startsWith('src/renderer/src/') ||
    repoPath.startsWith('src/plugins/renderer/')
  ) {
    return 'renderer';
  }
  if (repoPath.startsWith('src/main/') || repoPath.startsWith('src/plugins/main/')) {
    return 'main';
  }
  return null;
}

function classifyTarget(imported: ImportRef): {
  targetSurface: TargetSurface;
  targetPath?: string;
} {
  const { specifier } = imported;
  if (specifier === 'electron') return { targetSurface: 'electron' };
  if (isNodeRuntimeModule(specifier)) return { targetSurface: 'node-runtime' };
  if (!specifier.startsWith('.')) return { targetSurface: 'external' };

  const resolvedPath = toRepoPath(resolve(dirname(join(REPO_ROOT, imported.sourceFile)), specifier));
  if (resolvedPath.startsWith('src/main/') || resolvedPath.startsWith('src/plugins/main/')) {
    return { targetSurface: 'main', targetPath: resolvedPath };
  }
  if (resolvedPath.startsWith('src/preload/')) {
    return { targetSurface: 'preload', targetPath: resolvedPath };
  }
  if (
    resolvedPath.startsWith('src/renderer/') ||
    resolvedPath.startsWith('src/plugins/renderer/')
  ) {
    return { targetSurface: 'renderer', targetPath: resolvedPath };
  }
  if (resolvedPath.startsWith('src/shared/')) {
    return { targetSurface: 'shared', targetPath: resolvedPath };
  }
  if (resolvedPath === 'src/plugins/types' || resolvedPath === 'src/plugins/types.ts') {
    return { targetSurface: 'plugins-contract', targetPath: resolvedPath };
  }
  if (resolvedPath.startsWith('src/plugins/')) {
    return { targetSurface: 'plugins-other', targetPath: resolvedPath };
  }
  return { targetSurface: 'unknown', targetPath: resolvedPath };
}

function checkBoundary(imported: ResolvedImport): BoundaryViolation | null {
  const { sourceSurface, targetSurface } = imported;

  if (
    sourceSurface === 'shared' &&
    ['main', 'preload', 'renderer', 'plugins-contract', 'plugins-other'].includes(targetSurface)
  ) {
    return violation(
      imported,
      'shared-purity',
      'Shared code must not import app-layer implementation or plugin code. ' +
        'Move common JSON-safe contracts into src/shared/* and invert the dependency.',
    );
  }

  if (sourceSurface === 'shared' && ['electron', 'node-runtime'].includes(targetSurface)) {
    return violation(
      imported,
      'shared-runtime-import',
      'Shared code must stay runtime-neutral; do not import Electron or Node runtime modules.',
    );
  }

  if (sourceSurface === 'renderer' && ['main', 'preload'].includes(targetSurface)) {
    return violation(
      imported,
      'renderer-to-privileged-layer',
      'Renderer code must not import main/preload implementation. ' +
        'Use the typed window.canvasWorkspace API exposed by preload.',
    );
  }

  if (sourceSurface === 'renderer' && ['electron', 'node-runtime'].includes(targetSurface)) {
    return violation(
      imported,
      'renderer-runtime-import',
      'Renderer code must not import Electron or Node runtime modules. ' +
        'Expose privileged capabilities through main IPC and the preload bridge.',
    );
  }

  if (sourceSurface === 'main' && ['renderer', 'preload'].includes(targetSurface)) {
    return violation(
      imported,
      'main-to-browser-layer',
      'Main-side code must not import renderer/preload implementation. ' +
        'Share contracts through src/shared/* instead.',
    );
  }

  if (sourceSurface === 'preload' && ['renderer', 'main'].includes(targetSurface)) {
    return violation(
      imported,
      'preload-to-app-layer',
      'Preload must not import renderer/main implementation. ' +
        'Move cross-process API contracts to src/shared/* and keep policy in main.',
    );
  }

  return null;
}

function violation(
  imported: ResolvedImport,
  rule: string,
  message: string,
): BoundaryViolation {
  return { imported, rule, message };
}

function isNodeRuntimeModule(specifier: string): boolean {
  if (specifier.startsWith('node:')) return true;

  const parts = specifier.split('/');
  return (
    NODE_BUILTINS.has(specifier) ||
    NODE_BUILTINS.has(parts[0]) ||
    (parts.length > 1 && NODE_BUILTINS.has(`${parts[0]}/${parts[1]}`))
  );
}

function formatFailure(
  violations: BoundaryViolation[],
  staleAllowlistEntries: string[],
): string {
  const sections: string[] = [];

  if (violations.length > 0) {
    sections.push(
      [
        'Import boundary violations:',
        ...violations.map(formatViolation),
      ].join('\n'),
    );
  }

  if (staleAllowlistEntries.length > 0) {
    sections.push(
      [
        'Stale preload boundary allowlist entries:',
        ...staleAllowlistEntries.map((key) => {
          const reason = ALLOWED_PRELOAD_BOUNDARY_IMPORTS.get(key);
          return `- ${key}: ${reason} Remove this allowlist entry if the import was migrated.`;
        }),
      ].join('\n'),
    );
  }

  return sections.join('\n\n');
}

function formatViolation({ imported, rule, message }: BoundaryViolation): string {
  const target = imported.targetPath ?? imported.specifier;
  return [
    `- ${imported.sourceFile}:${imported.line}`,
    `imports "${imported.specifier}"`,
    `targeting ${target}`,
    `[${rule}].`,
    message,
  ].join(' ');
}

function toRepoPath(path: string): string {
  return relative(REPO_ROOT, path).split(sep).join('/');
}
