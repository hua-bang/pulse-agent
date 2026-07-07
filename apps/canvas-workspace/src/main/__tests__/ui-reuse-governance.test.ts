import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { extname, join, relative, sep } from 'path';

/**
 * UI reuse governance — the mechanical acceptance lines of
 * harness/spec/ui-reuse-unification.md (decided 2026-07-07).
 *
 * Policy is a NEW-CODE RATCHET, mirroring file-size-governance: every
 * counter may shrink or hold, never grow. When you reduce one (migrate a
 * bespoke button to components/ui/, tokenize a radius, adopt
 * useEscapeClose), update the baseline DOWNWARD in the same PR. Raising a
 * baseline requires the recorded reason the spec's reuse criterion demands.
 */

const RENDERER_ROOT = join('src', 'renderer', 'src');

const RATCHET_BASELINE: Record<string, number> = {
  // raw <button> tags in .tsx — falls as components/ui/Button absorbs them.
  // 402→399: WorkspaceSettings adopted ui/Button (-4); ui/Button itself (+1).
  rawButtonTags: 399,
  // border-radius declarations not using var(--radius*) — radius is the
  // first tokenization target per the spec decision. 435→431: ui/ CSS is
  // tokenized and the promoted Drawer + deleted CTA rules dropped 4 literals.
  borderRadiusLiterals: 431,
  // independent 360°-rotate spinner @keyframes (names ending in "spin")
  spinnerKeyframes: 6,
  // role="dialog" occurrences — falls as the ui/ overlay shell absorbs them.
  // 12→11: AppShell Confirm+Shortcuts (-2) now route through ui/Modal (+1).
  dialogRoles: 11,
  // files calling createPortal directly (no shared wrapper yet).
  portalFiles: 11, // +1: ui/Modal is the consolidation shell; adoptions remove caller portals over time
  // hand-rolled window keydown listeners inside components/ — overlay ESC
  // belongs in useEscapeClose / the ui/ shells. 10→7: SettingsDrawer→ui/Drawer
  // and both AppShell dialogs dropped their ESC listeners for the shared hooks.
  componentWindowKeydown: 7,
};

// Design tokens referenced via var(--x) somewhere in the renderer but
// defined nowhere (no `--x:` in CSS, no quoted '--x' in TS/TSX). Each entry
// renders as fallback-or-initial today. Shrink by defining the token or
// repointing the references; a stale entry here (token now defined, or no
// longer referenced) must be removed.
const KNOWN_UNDEFINED_TOKENS = new Set([
  '--accent-muted',
  '--accent-soft',
  '--accent-soft-strong',
  '--border-subtle',
  '--frame-bg-alpha',
  '--frame-title-gap',
  '--note-paper',
  '--surface-1',
  '--surface-2',
  '--surface-alt',
  '--surface-subtle',
  '--text-primary',
  '--text-tertiary',
]);

interface SourceFile {
  path: string;
  content: string;
}

const collectFiles = (dir: string, out: SourceFile[] = []): SourceFile[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, out);
    } else if (['.css', '.ts', '.tsx'].includes(extname(entry.name))) {
      out.push({
        path: relative(process.cwd(), full).split(sep).join('/'),
        content: readFileSync(full, 'utf-8'),
      });
    }
  }
  return out;
};

const files = collectFiles(RENDERER_ROOT);
const cssFiles = files.filter((f) => f.path.endsWith('.css'));
const tsxFiles = files.filter((f) => f.path.endsWith('.tsx'));
const tsLikeFiles = files.filter((f) => /\.tsx?$/.test(f.path));

const countMatches = (sources: SourceFile[], regex: RegExp): number =>
  sources.reduce((sum, f) => sum + (f.content.match(regex) ?? []).length, 0);

describe('ui reuse governance (ratchet — counters may shrink, never grow)', () => {
  const measured: Record<string, number> = {
    rawButtonTags: countMatches(tsxFiles, /<button\b/g),
    borderRadiusLiterals: cssFiles.reduce(
      (sum, f) =>
        sum +
        f.content
          .split('\n')
          .filter((line) => /border-radius\s*:/.test(line) && !line.includes('var('))
          .length,
      0,
    ),
    spinnerKeyframes: countMatches(cssFiles, /@keyframes\s+\S*[sS]pin\s*\{/g),
    dialogRoles: countMatches(tsxFiles, /role="dialog"/g),
    portalFiles: tsLikeFiles.filter((f) => f.content.includes('createPortal(')).length,
    componentWindowKeydown: tsLikeFiles
      .filter((f) => f.path.includes('/components/'))
      .reduce((sum, f) => sum + (f.content.match(/window\.addEventListener\('keydown'/g) ?? []).length, 0),
  };

  for (const [counter, baseline] of Object.entries(RATCHET_BASELINE)) {
    it(`${counter} stays at or below baseline (${baseline})`, () => {
      const value = measured[counter];
      if (value > baseline) {
        throw new Error(
          `${counter} grew: ${value} > baseline ${baseline}. New code must reuse the ` +
            'blessed implementation (components/ui/, the shared hooks, or a token) — see ' +
            'harness/spec/ui-reuse-unification.md. If this growth is deliberate, record ' +
            'the reason and raise the baseline in the same PR.',
        );
      }
      if (value < baseline) {
        throw new Error(
          `${counter} improved: ${value} < baseline ${baseline}. Lock in the win — ` +
            'lower the baseline to the new value in this PR.',
        );
      }
      expect(value).toBe(baseline);
    });
  }

  it('every var(--token) reference resolves to a definition (no NEW phantom tokens)', () => {
    const used = new Set<string>();
    for (const f of [...cssFiles, ...tsxFiles]) {
      for (const m of f.content.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)/g)) used.add(m[1]);
    }
    const defined = new Set<string>();
    for (const f of cssFiles) {
      for (const m of f.content.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)) defined.add(m[1]);
    }
    for (const f of tsLikeFiles) {
      for (const m of f.content.matchAll(/['"](--[a-zA-Z0-9_-]+)['"]/g)) defined.add(m[1]);
    }

    const undefinedNow = [...used].filter((t) => !defined.has(t)).sort();
    const newPhantoms = undefinedNow.filter((t) => !KNOWN_UNDEFINED_TOKENS.has(t));
    const staleBaseline = [...KNOWN_UNDEFINED_TOKENS].filter((t) => !undefinedNow.includes(t)).sort();

    expect(
      newPhantoms,
      `new undefined design-token reference(s): ${newPhantoms.join(', ')} — define the token or use an existing one`,
    ).toEqual([]);
    expect(
      staleBaseline,
      `KNOWN_UNDEFINED_TOKENS is stale — these are now defined or unused, remove them: ${staleBaseline.join(', ')}`,
    ).toEqual([]);
  });
});
