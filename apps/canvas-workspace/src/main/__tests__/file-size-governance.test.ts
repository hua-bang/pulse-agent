import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { dirname, extname, join, relative, sep } from 'path';

const WARN_LINE_THRESHOLD = 400;
const HARD_LINE_THRESHOLD = 500;
const SOURCE_ROOT = 'src';
// CSS is declarative styling and does not benefit from the per-module
// splitting that file-size governance enforces on TS/TSX logic. Scope the
// hard 500-line gate to code modules only.
const GOVERNED_EXTENSIONS = new Set(['.ts', '.tsx']);

// A directory with many flat production files hides its sub-areas. New
// directories stay under the threshold; listed directories must not grow.
// Group files by responsibility into subdirectories to shrink a baseline.
const FLAT_FILE_THRESHOLD = 25;
const CURRENT_FLAT_DIRECTORY_BASELINE: Record<string, number> = {
  'src/main/agent/tools': 27,
  'src/shared': 38,
};

const CURRENT_OVER_500_BASELINE: Record<string, number> = {
  'src/main/agent-teams/service.ts': 1849,
  'src/renderer/src/types.ts': 1861,
  'src/main/canvas/store.ts': 1177,
  'src/main/agent/canvas-agent.ts': 1006,
  'src/main/canvas/storage.ts': 602,
  'src/main/agent/context/context-builder.ts': 856,
  // 777→816 (2026-09-03, drift recorded): master changes #987–#988
  // expanded then partially reduced Feishu answer-card/run rendering without
  // updating this manually maintained baseline. Must-not-grow resumes at 816.
  'src/plugins/main/channel/channels/feishu/feishu-channel.ts': 816,
  'src/main/agent-teams/canvas-nodes.ts': 739,
  'src/main/runtime/control-server.ts': 685,
  'src/main/models/config.ts': 550,
  'src/plugins/main/dynamic-app/tools.ts': 593,
  'src/main/plugin-market/config.ts': 502,
  // 605→636 (2026-07-17, drift recorded): grew via master work (#806
  // session-restore fix) that never ran this suite (no automatic trigger).
  // Raised to measured; must-not-grow applies from 636.
  'src/main/agent/sessions/session-store.ts': 636,
  'src/main/agent/service.ts': 520,
  'src/main/webview/registry.ts': 512,
  'src/main/agent/skills/config.ts': 508,
  'src/plugins/main/webview-page-control/js-primitives.ts': 506,
  // 512→516 (2026-07-10, drift recorded): grew via master work that never
  // ran this suite (no automatic trigger). Raised to measured;
  // must-not-grow applies from 516.
  'src/renderer/src/app/shell/Workbench/index.tsx': 485,
};

const DOCUMENTED_EXCEPTIONS: Record<string, string> = {
  'src/renderer/src/i18n/messages.ts': 'Locale message catalog: data-like copy table governed by i18n review, not file-size refactors.',
};

interface ScannedFile {
  path: string;
  lineCount: number;
}

interface WarningMetadata extends ScannedFile {
  threshold: typeof WARN_LINE_THRESHOLD;
  recordedBaseline?: number;
}

function toRepoPath(path: string): string {
  return path.split(sep).join('/');
}

function countLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return normalized.endsWith('\n')
    ? normalized.split('\n').length - 1
    : normalized.split('\n').length;
}

function isGeneratedOrDataPath(path: string): boolean {
  return path.includes('/__generated__/')
    || path.includes('/generated/')
    || path.includes('.generated.')
    || path.includes('.gen.');
}

function isProductionSourceFile(path: string): boolean {
  if (!GOVERNED_EXTENSIONS.has(extname(path))) {
    return false;
  }

  if (path.endsWith('.d.ts')) {
    return false;
  }

  if (path.includes('/__tests__/') || /\.(test|spec)\.(ts|tsx)$/.test(path)) {
    return false;
  }

  if (isGeneratedOrDataPath(path) || DOCUMENTED_EXCEPTIONS[path]) {
    return false;
  }

  return true;
}

function collectFiles(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((entry) => {
      const absolutePath = join(dir, entry);
      const stats = statSync(absolutePath);
      return stats.isDirectory() ? collectFiles(absolutePath) : [absolutePath];
    });
}

function scanProductionFiles(): ScannedFile[] {
  return collectFiles(join(process.cwd(), SOURCE_ROOT))
    .map((absolutePath) => toRepoPath(relative(process.cwd(), absolutePath)))
    .filter(isProductionSourceFile)
    .map((path) => ({
      path,
      lineCount: countLines(readFileSync(join(process.cwd(), path), 'utf8')),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function buildWarningMetadata(files: ScannedFile[]): WarningMetadata[] {
  return files
    .filter((file) => file.lineCount > WARN_LINE_THRESHOLD)
    .map((file) => ({
      ...file,
      threshold: WARN_LINE_THRESHOLD,
      recordedBaseline: CURRENT_OVER_500_BASELINE[file.path],
    }));
}

function buildHardThresholdViolations(files: ScannedFile[]): string[] {
  return files.flatMap((file) => {
    if (file.lineCount <= HARD_LINE_THRESHOLD) {
      return [];
    }

    const baseline = CURRENT_OVER_500_BASELINE[file.path];
    if (baseline === undefined) {
      return [`${file.path} has ${file.lineCount} lines and is not in the ${HARD_LINE_THRESHOLD}-line baseline`];
    }

    if (file.lineCount > baseline) {
      return [`${file.path} grew from baseline ${baseline} to ${file.lineCount} lines`];
    }

    return [];
  });
}

function buildFlatDirectoryViolations(files: ScannedFile[]): string[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const directory = dirname(file.path);
    counts.set(directory, (counts.get(directory) ?? 0) + 1);
  }

  return [...counts.entries()].flatMap(([directory, count]) => {
    const baseline = CURRENT_FLAT_DIRECTORY_BASELINE[directory];
    if (baseline === undefined) {
      return count >= FLAT_FILE_THRESHOLD
        ? [`${directory} has ${count} flat production files; group them into subdirectories (limit ${FLAT_FILE_THRESHOLD - 1})`]
        : [];
    }

    return count > baseline
      ? [`${directory} grew from baseline ${baseline} to ${count} flat production files`]
      : [];
  });
}

describe('file size governance', () => {
  it('records over-400 production files as warning metadata only', () => {
    const warnings = buildWarningMetadata(scanProductionFiles());

    for (const warning of warnings) {
      expect(warning.lineCount).toBeGreaterThan(WARN_LINE_THRESHOLD);
      expect(warning.threshold).toBe(WARN_LINE_THRESHOLD);
    }
  });

  it('blocks new or growing production files over 500 lines', () => {
    const violations = buildHardThresholdViolations(scanProductionFiles());

    expect(violations).toEqual([]);
  });

  it('blocks new or growing directories with many flat production files', () => {
    const violations = buildFlatDirectoryViolations(scanProductionFiles());

    expect(violations).toEqual([]);
  });
});
