import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

/**
 * Bundle boundary gate.
 *
 * The renderer has exactly one maintained lazy-loading boundary today:
 * `chat/utils/mermaid.ts` does `import('mermaid')`, which keeps mermaid and
 * its ~5 MB of diagram sub-chunks out of the eagerly-parsed entry chunk
 * (measured: entry 4.6 MB raw / 1.0 MB gzip WITHOUT mermaid — see
 * perf/baselines.json). This test walks the STATIC import graph from the
 * renderer entry and fails if any watch-listed package becomes statically
 * reachable, which would silently fold it back into the startup chunk.
 *
 * As C-dimension fixes land (React.lazy for node bodies, manualChunks),
 * move packages from EXPECTED_STATIC into WATCHLIST to ratchet the gate.
 */

/** Packages that must NEVER be statically imported from the entry graph. */
const WATCHLIST = ['mermaid'];

/**
 * Heavy packages that ARE statically reachable today (C1-C9 findings).
 * Documented so the day one moves behind a lazy boundary, it gets promoted
 * to WATCHLIST instead of silently regressing later.
 */
const EXPECTED_STATIC = [
  '@xterm/xterm',
  'highlight.js',
  'markdown-it',
  'react-force-graph-2d',
];

const testDir = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(testDir, '../..'); // apps/canvas-workspace/src
const entryFile = join(srcRoot, 'renderer/src/main.tsx');

const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];
// Static `import ... from 'x'`, `export ... from 'x'`, bare `import 'x'`.
// Dynamic `import('x')` deliberately does not match.
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[^;'"]*?from\s+)?['"]([^'"]+)['"]/g;

const resolveRelative = (fromFile: string, spec: string): string | null => {
  const base = resolve(dirname(fromFile), spec);
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = base + suffix;
    if (candidate.match(/\.(ts|tsx)$/) && existsSync(candidate)) return candidate;
  }
  return null; // css / assets / json — not part of the JS graph we gate
};

const packageName = (spec: string): string => {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
};

const collectStaticPackages = (): { packages: Set<string>; files: number } => {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const queue = [entryFile];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf-8');
    for (const match of source.matchAll(IMPORT_RE)) {
      const spec = match[1];
      if (spec.startsWith('.')) {
        const resolved = resolveRelative(file, spec);
        if (resolved) queue.push(resolved);
      } else {
        packages.add(packageName(spec));
      }
    }
  }
  return { packages, files: seen.size };
};

describe('bundle boundaries (static import graph from renderer entry)', () => {
  const { packages, files } = collectStaticPackages();

  it('walks a non-trivial graph (sanity)', () => {
    expect(files).toBeGreaterThan(50);
    expect(packages.has('react')).toBe(true);
  });

  it.each(WATCHLIST)('%s stays dynamic-only (never in the startup chunk)', (pkg) => {
    expect(
      packages.has(pkg),
      `${pkg} became statically reachable from main.tsx — it will be folded into the eagerly-parsed entry chunk. Load it via import() instead (see chat/utils/mermaid.ts).`,
    ).toBe(false);
  });

  it('mermaid lazy boundary still exists', () => {
    const mermaidUtil = readFileSync(
      join(srcRoot, 'renderer/src/components/chat/utils/mermaid.ts'),
      'utf-8',
    );
    expect(mermaidUtil).toMatch(/import\(\s*['"]mermaid['"]\s*\)/);
  });

  it('documents today\'s heavy static deps (promote to WATCHLIST when made lazy)', () => {
    for (const pkg of EXPECTED_STATIC) {
      expect(
        packages.has(pkg),
        `${pkg} is no longer statically reachable — great! Move it from EXPECTED_STATIC to WATCHLIST in this test to lock the improvement in.`,
      ).toBe(true);
    }
  });
});
