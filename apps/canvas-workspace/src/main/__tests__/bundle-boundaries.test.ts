import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

/**
 * Bundle boundary gate.
 *
 * Walks the STATIC import graph from the renderer entry (main.tsx) and fails
 * if any watch-listed package becomes statically reachable, which would
 * silently fold it back into the startup chunk. Maintained lazy boundaries:
 *  - chat/utils/mermaid.ts does `import('mermaid')` (keeps mermaid + its
 *    diagram sub-chunks out of the entry).
 *  - GraphPageLazy (B6) React.lazy-loads react-force-graph-2d + d3-force.
 *  - DefaultCanvasNode (C1/C6) React.lazy-loads the 5 heavy node bodies
 *    (text/file/agent/frame/terminal), evicting @tiptap/starter-kit +
 *    lowlight from the entry.
 *  - chat/lazy.tsx (C3) React.lazy-loads ChatPage + ChatPanel, evicting
 *    highlight.js + markdown-it + the chat tree.
 *  - WorkspaceTerminalPortal (C2) React.lazy-loads WorkspaceTerminalDock,
 *    evicting @xterm/xterm and its CSS from the startup closure.
 *  - federation.ts (C7) dynamic-imports @module-federation/runtime.
 *  - useCanvasSearch (chain B) dynamic-imports noteSearchExtension, evicting
 *    @tiptap/react + @tiptap/pm.
 *  - AppLazyBoundaries and conditional overlay shells keep Settings, Nodes,
 *    Reference Drawer, DevTools and infrequent Canvas controls off startup.
 *
 * When a new heavy dep lands statically, either lazy it and add it here, or
 * consciously accept the entry-size ratchet hit (perf/baselines.json).
 */

/** Packages that must NEVER be statically imported from the entry graph. */
const WATCHLIST = [
  'mermaid',
  'react-force-graph-2d',
  // C1/C6: evicted by React.lazy-ing the 5 heavy node bodies.
  '@tiptap/starter-kit',
  'lowlight',
  // Chain B: noteSearchExtension is dynamic-imported from useCanvasSearch.
  '@tiptap/react',
  '@tiptap/pm',
  // C2: WorkspaceTerminalDock behind React.lazy (JS only — CSS is exempt).
  '@xterm/xterm',
  // C3: chat surfaces behind React.lazy (chat/lazy.tsx).
  'highlight.js',
  'markdown-it',
  // C7: federation runtime dynamic-imported on first plugin activation.
  '@module-federation/runtime',
];

const DYNAMIC_ONLY_MODULE_SUFFIXES = [
  '/components/Settings/index.tsx',
  '/components/WorkspaceSettings/index.tsx',
  '/components/WorkspaceNodes/NodesPage.tsx',
  '/components/WorkspaceNodes/NodeDetailPage.tsx',
  '/components/ReferenceDrawer/index.tsx',
  '/components/CommandPalette/index.tsx',
  '/components/SearchBar/index.tsx',
  '/components/EdgeStylePanel/index.tsx',
  '/components/artifacts/ArtifactTabView.tsx',
  '/plugins/renderer/devtools/AgentDebugPage.tsx',
  '/plugins/renderer/devtools/ChatDebugTrace.tsx',
];

const testDir = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(testDir, '../..'); // apps/canvas-workspace/src
const entryFile = join(srcRoot, 'renderer/src/main.tsx');
const packageJson = JSON.parse(readFileSync(resolve(srcRoot, '../package.json'), 'utf-8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const RENDERER_ONLY_DEPENDENCIES = [
  '@module-federation/runtime',
  '@tiptap/extension-bubble-menu',
  '@tiptap/extension-code-block-lowlight',
  '@tiptap/extension-highlight',
  '@tiptap/extension-image',
  '@tiptap/extension-link',
  '@tiptap/extension-paragraph',
  '@tiptap/extension-placeholder',
  '@tiptap/extension-table',
  '@tiptap/extension-table-cell',
  '@tiptap/extension-table-header',
  '@tiptap/extension-table-row',
  '@tiptap/extension-task-item',
  '@tiptap/extension-task-list',
  '@tiptap/extension-underline',
  '@tiptap/pm',
  '@tiptap/react',
  '@tiptap/starter-kit',
  '@xterm/addon-fit',
  '@xterm/xterm',
  'highlight.js',
  'lowlight',
  'markdown-it',
  'markdown-it-task-lists',
  'mermaid',
  'react',
  'react-dom',
  'react-force-graph-2d',
  'tiptap-markdown',
  'wouter',
];

const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];
// Static `import ... from 'x'`, `export ... from 'x'`, bare `import 'x'`.
// Dynamic `import('x')` deliberately does not match.
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^;'"]*?from\s+)?['"]([^'"]+)['"]/g;

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

const collectStaticPackages = (): { packages: Set<string>; files: Set<string> } => {
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
      // Style imports extract to CSS assets, not the entry JS chunk — a bare
      // `import '@xterm/xterm/css/xterm.css'` must not trip the JS watchlist.
      if (spec.endsWith('.css')) continue;
      if (spec.startsWith('.')) {
        const resolved = resolveRelative(file, spec);
        if (resolved) queue.push(resolved);
      } else {
        packages.add(packageName(spec));
      }
    }
  }
  return { packages, files: seen };
};

describe('bundle boundaries (static import graph from renderer entry)', () => {
  const { packages, files } = collectStaticPackages();

  it('walks a non-trivial graph (sanity)', () => {
    expect(files.size).toBeGreaterThan(50);
    expect(packages.has('react')).toBe(true);
  });

  it.each(DYNAMIC_ONLY_MODULE_SUFFIXES)('%s stays outside the startup graph', (suffix) => {
    expect(
      [...files].some((file) => file.endsWith(suffix)),
      `${suffix} became statically reachable from main.tsx; restore its lazy boundary`,
    ).toBe(false);
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

});

describe('packaged dependency boundary', () => {
  it.each(RENDERER_ONLY_DEPENDENCIES)('%s is build-time only', (pkg) => {
    expect(packageJson.dependencies?.[pkg]).toBeUndefined();
    expect(packageJson.devDependencies?.[pkg]).toBeTypeOf('string');
  });
});
