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

// Known NON-gated channels (deliberately out of scope for this ratchet, and
// why): tsx inline-style colors — dominated by legitimate content palettes
// (shape/frame/edge color pickers, graph data-viz), not chrome literals;
// dangerouslySetInnerHTML — renders untrusted/rich content, not component
// chrome; canvas fillStyle — export-only drawing code, never on-screen UI
// chrome; .ts createElement — no button/input is built that way today (all
// current instances are non-form DOM plumbing), so gating it would be
// measuring zero for no benefit. Revisit only if one of these channels
// starts accumulating real chrome literals.
const RATCHET_BASELINE: Record<string, number> = {
  // Tag counters below are measured on COMMENT-STRIPPED sources, so doc
  // mentions of an element never count and never force baseline churn.
  // raw <button> tags in .tsx — falls as components/ui/Button absorbs them.
  // 402→399: WorkspaceSettings adopted ui/Button (-4); ui/Button itself (+1).
  // 399→397: AgentTypeSelect migrated to ui/Select, dropping its bespoke
  // trigger + option <button>s (-2). ui/Select itself moved, not added.
  // 397→390 (batch-A UI-reuse pass): AgentTeamFrame's 4 tablist-shaped
  // clusters moved onto ui/SegmentedControl, dropping 7 bespoke <button>s
  // (2 subtabs + 2 detail-tabs + 1 round-switch [a single .map <button>] + 2
  // inspector-viewer-tabs — the one that was missing role="tab"/aria-selected
  // entirely); SegmentedControl itself adds one shared <button> (its own
  // .map body), net -6 there. LinkDrawer's reload icon button moved onto
  // ui/Button's new icon variant (-1). Total -7.
  rawButtonTags: 390,
  // raw <input> tags in .tsx — falls as components/ui/TextField absorbs them.
  // 55→54: ui/TextField's own <input> (+1), WorkspaceSettings name field
  // migrated (-1), and comment-stripping dropped one doc mention (-1).
  rawInputTags: 54,
  // raw <textarea> tags in .tsx — falls as ui/TextField(multiline) absorbs
  // them. Held at the pre-extension 13: ui/TextField's own <textarea> (+1)
  // is offset by PromptSettings' custom-prompt field adopting TextField (-1).
  rawTextareaTags: 13,
  // real native <select> elements — the blessed control is the ui/Select
  // custom popover. 0: none exist; this is a pure backstop against
  // reintroduction (doc mentions no longer count — comment-stripped).
  rawSelectTags: 0,
  // border-radius declarations not using var(--radius*) — radius is the
  // first tokenization target per the spec decision. 435→431: ui/ CSS is
  // tokenized and the promoted Drawer + deleted CTA rules dropped 4 literals.
  // 431→425: ui/Select promotion tokenized its 3 radii (-3) and the retired
  // agent-type-select CSS dropped 3 more literals (-3).
  // 425→416 (batch-A): ui/DropdownShell absorbed 2 hand-rolled popovers'
  // hardcoded 8px radii (text-color-popover, frame-color-popover); the 4
  // AgentTeamFrame SegmentedControl migrations dropped 6 more (subtab 0,
  // detail-tab 6px, round-switch 8px + its tab 6px, inspector-viewer-tabs
  // 7px + its button 5px); LinkDrawer's icon button (4px) moved onto
  // ui/Button (tokenized). 9 literals removed net.
  borderRadiusLiterals: 416,
  // independent 360°-rotate spinner @keyframes (names ending in "spin")
  spinnerKeyframes: 6,
  // private entrance @keyframes whose NAME ends in an entrance-shaped suffix
  // (-in / -appear / -rise / -slide), excluding the two blessed globals
  // fadeIn + menuAppear (camelCase, so the hyphen-delimited regex skips them
  // for free). Name-based like spinnerKeyframes; new code should reference
  // the global menuAppear (opacity+scale+rise) or fadeIn (opacity) instead of
  // minting a near-duplicate private keyframe. The remaining 12 are either
  // meaningfully directional/distinct (e.g. agent-team-inspector-panel-in
  // slides from the right, right-dock-tab-rise is a selection micro-lift,
  // ui-drawer-in is the blessed Drawer's own slide, iframe-shimmer-slide is a
  // loading shimmer) or simply out of this backlog's flagged scope — so the
  // practical floor is nonzero. Measured 14→12: agent-team-inspector-backdrop-in
  // folded into fadeIn (byte-identical: opacity 0→1, review-verified) and
  // reference-workspace-menu-in folded into menuAppear (a deliberate
  // normalization, NOT byte-identical — old was translateY(-4px)/scale(0.985),
  // menuAppear is translateY(-2px)/scale(0.97); review-verified as a real but
  // imperceptible amplitude difference, same category as the earlier token
  // convergence's dominant-value picks).
  privateEntranceKeyframes: 12,
  // role="dialog" occurrences — falls as the ui/ overlay shell absorbs them.
  // 12→11: AppShell Confirm+Shortcuts (-2) now route through ui/Modal (+1).
  // 11→12: ui/Drawer gained role="dialog" + aria-modal (P3 a11y hardening —
  // it previously had neither), so both blessed overlay shells now expose
  // the dialog role consistently. A deliberate increase, not a regression.
  dialogRoles: 12,
  // files calling createPortal directly. ui/Portal is the one blessed exit;
  // Modal/Drawer render through it. Falls as legacy callers adopt <Portal> or
  // the new point-anchored ui/Popover shell.
  // 10→9: NodeContextMenu + EdgeContextMenu dropped their direct createPortal
  // (-2) by moving onto ui/Popover; ui/Popover itself adds one shared exit
  // (+1). Net -1. (LayerContextMenu also moved onto Popover but never called
  // createPortal directly.)
  portalFiles: 9,
  // non-ui, non-test .tsx files that BOTH import useViewportClampedPosition
  // AND call createPortal — the signature of a hand-rolled point-anchored
  // popover shell living outside ui/Popover. Post-migration the three canvas
  // context menus (Node/Edge/Layer) route through ui/Popover, so the only
  // remaining two are NoteMentionMenu + SlashCommandMenu — combobox-style
  // menus with index-driven arrow-nav coupled to filtering state, which
  // Popover's DOM-focus useMenuKeyboardNav model deliberately does not serve.
  bespokePopoverPositioning: 2,
  // Hand-rolled keydown listeners — overlay ESC belongs in useEscapeClose /
  // the ui/ shells. History as componentWindowKeydown (scoped to
  // components/, window.addEventListener('keydown' only): 10→7 —
  // SettingsDrawer→ui/Drawer and both AppShell dialogs dropped their ESC
  // listeners for the shared hooks.
  // 2026-07-08: renamed handRolledKeydown and WIDENED to (a) also count
  // document.addEventListener('keydown' — useEscapeClose, useClickOutside,
  // and the new useFocusTrap all listen on `document` in the capture phase,
  // which the old window-only regex missed entirely — and (b) scan ALL of
  // src/renderer/src (components + hooks + App.tsx), not just components/.
  // Honest widening, not a regression: 7→20. A census triaged the
  // components-scope holdouts before the widening — ~4 are legitimately
  // non-migratable (2 gesture-cancel: canvas drag-abort in
  // useCanvasMouseHandlers.ts, mindmap reorder-abort in
  // useMindmapController.ts; 2 mixed multi-key: lightbox arrows+ESC in
  // ChatImageLightbox.tsx, GraphPage Cmd+F+ESC in GraphPage.tsx) — each of
  // those listeners legitimately owns more than plain Escape-closes-overlay,
  // so this counter's practical floor is nonzero; the goal is the
  // migratable remainder, not zero.
  // 20→17 (2026-07-08, review): the three canonical keyboard primitives
  // (useEscapeClose, useMenuKeyboardNav, ui/useFocusTrap) are now exempt —
  // they ARE the blessed destination, and counting them forced a baseline
  // raise whenever a new blessed hook landed.
  handRolledKeydown: 17,
  // hardcoded color literals (hex/rgb/oklch) in renderer CSS on lines that do
  // NOT define a custom property — new-code color ratchet (token-definition
  // lines are exempt: defining a token with a literal is the point). Falls as
  // colors move onto the palette; migration of the stock is deliberately
  // unscheduled.
  // 1961→1935 (batch-A): real deletions, not tokenization — the migrated
  // sites' bespoke color rules (Settings section title/desc colors, the 2
  // color-picker popovers, the 4 AgentTeamFrame tab-strip clusters,
  // LinkDrawer's icon button) were removed outright.
  // 1935→1934 (batch-A review): the review caught that SegmentedControl's
  // hover shipped a raw rgba() — the earlier "new ui/ components add nothing
  // to this counter" claim was FALSE by one; now tokenized (--surface-alt)
  // and the claim holds again.
  hardcodedColorLiterals: 1934,
  // box-shadow declaration lines not using a var(--shadow-*) token — same
  // line-based style as borderRadiusLiterals. frontend.md previously said
  // "measured but not yet gated"; gated 2026-07-08 at the as-measured
  // baseline (no migration performed — the stock is deliberately
  // unscheduled, matching hardcodedColorLiterals).
  // 174→200 (2026-07-08, review): NOT growth — the exemption was tightened
  // from any-var( to var(--shadow specifically (a token-colored but
  // literal-geometry shadow now counts, matching what frontend.md promises);
  // 26 such lines moved inside the gate.
  // 200→196 (batch-A): the 2 color-picker popovers (text/frame) and 2
  // AgentTeamFrame active-tab box-shadows (detail-tab, round-switch__tab)
  // now come from ui/DropdownShell (var(--shadow-float)) or a plain
  // ui/SegmentedControl active state with no shadow.
  // 196→170 (C0, counter hygiene — production CSS untouched): the counter
  // was inflated by two false positives — `box-shadow: none;` (26 lines) is
  // not a shadow literal at all, and a whole-value reference to a
  // shadow-purpose token that isn't spelled `var(--shadow...)` (5 lines, all
  // `var(--nodes-shadow)` in WorkspaceNodes/index.css) is already tokenized.
  // Both are now exempt WHEN THEY ARE THE ENTIRE VALUE; a line mixing
  // geometry with an unrelated var (e.g. `var(--border)`) or even a
  // shadow-purpose var (e.g. `0 0 0 1px var(--accent-border),
  // var(--nodes-shadow)`) still counts — the review lesson holds. Net -26.
  // Note for the record: the plan doc (ui-reuse-burndown.md) estimated the
  // honest count at "~165" from a 196 starting point, but 5 unrelated
  // box-shadow literals landed in IframeNodeBody/index.css via intervening
  // perf commits (084be2c/ccfd629 et al., after the 196 baseline was set)
  // before this batch ran — those 5 are real, still-uncounted drift, not a
  // false positive this batch's rule is meant to catch, so the true honest
  // floor is 170, not 165.
  shadowLiterals: 170,
  // z-index declarations with a raw numeric value >= 10, not via var() —
  // targets only the cross-surface stacking band. The documented rule
  // permits low local stacking inside a single component (60 of 93 raw
  // z-index literals are <=5 and legitimate); this counter ignores those
  // and gates only the band that actually competes with the --layer-*
  // scale for cross-surface stacking order.
  // 25→23 (batch-A): the 2 color-picker popovers' raw z-index:20 now come
  // from ui/DropdownShell's var(--layer-canvas-chrome-raised).
  zIndexHighRaw: 23,

  // --- batch-A new counters (measured post-migration) ---
  // CSS rule-block openers outside ui/ matching the `*-section-(title|desc|
  // body)` or `*-field` shape — the clusters ui/SectionHeader + ui/FieldRow
  // exist to absorb (a rule OPENER is the base selector immediately
  // followed by `{` — `.x-section-status-desc {` does not match, since
  // "status" sits between "section" and "desc"). UpdateSection and
  // LanguageSection's `-title`/`-field` rule openers, plus
  // WorkspaceSettings' `-field` opener, are already gone post-migration;
  // this is the first measurement of the counter, at the post-migration
  // value. The remaining 14 (7 title/desc/body + 7 field, across
  // AgentNodeBody, Sidebar, Settings/{AgentSection,ExperimentalSection},
  // WorkspaceSettings, ChannelConfigPanel, BuiltInToolsSection, ChatPanel,
  // settings-config) are frozen stock — new-code ratchet, not a sweep, per
  // the deliverable's explicit scope limit.
  sectionFieldCssClusters: 14,
  // non-ui, non-test .tsx files whose content has BOTH useClickOutside( AND
  // useMenuKeyboardNav( and NOT createPortal( — the signature of a
  // hand-rolled trigger-anchored dropdown living outside ui/DropdownShell.
  // 7 (census) minus 3 migrated (ShapeToolButton, TextColorPicker,
  // FrameColorPicker) = 4 remaining: ShapeNodeBody (richer multi-row style
  // picker, not a pick-and-close menu), chat/ChatAnchors + GraphPage's
  // overflow menu (both distinguish click-outside-close from
  // keyboard-close-with-focus-restore — a real behavior DropdownShell's
  // single internal `close` can't express), FloatingToolbar/index.tsx's
  // plugin menu (not evaluated this pass). NodeTagEditor is naturally
  // excluded — it uses useEscapeClose, not useMenuKeyboardNav.
  bespokeDropdownShells: 4,
  // role="tablist"/role="radiogroup" outside ui/ — the shape
  // ui/SegmentedControl absorbs. AgentTeamFrame's 4 (all migrated) are gone;
  // 5 remain as frozen stock: AgentNodeBody/AgentPicker's tablist,
  // RightDock's tab strip (excluded by design — glider/unread/closeable,
  // not a plain pill), and 3 radiogroups (Settings/LanguageSection,
  // chat/PromptSettings, chat/ModelProviderFields) — evaluated as optional
  // migrations and flagged: both are card/grid-style choosers (2-col grid,
  // bordered cards, box-shadow ring), a different visual language than
  // SegmentedControl's compact pill, so migrating would be a visual
  // downgrade rather than a clean unification.
  segmentedRoles: 5,
};

// Design tokens referenced via var(--x) somewhere in the renderer but
// defined nowhere (no `--x:` in CSS, no quoted '--x' in TS/TSX). 11 of the
// original 13 were CONVERGED 2026-07-07 (defined in styles.css :root from
// their own fallback demand). The two survivors are the oklch frame-engine
// dials — per-scope parameters read via fallback BY DESIGN (the engine is
// deliberately isolated from the palette); they stay here so a definition
// sneaking in gets flagged as a stale-baseline failure.
const KNOWN_UNDEFINED_TOKENS = new Set([
  '--frame-bg-alpha',
  '--frame-title-gap',
]);

interface SourceFile {
  path: string;
  content: string;
}

// Test files are excluded (same rule as file-size-governance): every counter
// targets PRODUCTION chrome, and counting test harness markup would force
// tests into unnatural contortions to avoid tripping the exact-match ratchet.
const isTestFile = (path: string): boolean =>
  path.includes('/__tests__/') || /\.(test|spec)\.(ts|tsx)$/.test(path);

const collectFiles = (dir: string, out: SourceFile[] = []): SourceFile[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, out);
    } else if (['.css', '.ts', '.tsx'].includes(extname(entry.name))) {
      const path = relative(process.cwd(), full).split(sep).join('/');
      if (isTestFile(path)) continue;
      out.push({ path, content: readFileSync(full, 'utf-8') });
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

// Strip /* */ and // comments so tag counters see real JSX only, not doc
// prose (the [^:"'] guard keeps https:// and quoted slashes intact).
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'])\/\/.*$/gm, '$1');

const countStripped = (sources: SourceFile[], regex: RegExp): number =>
  sources.reduce((sum, f) => sum + (stripComments(f.content).match(regex) ?? []).length, 0);

describe('ui reuse governance (ratchet — counters may shrink, never grow)', () => {
  const measured: Record<string, number> = {
    rawButtonTags: countStripped(tsxFiles, /<button\b/g),
    rawInputTags: countStripped(tsxFiles, /<input\b/g),
    rawTextareaTags: countStripped(tsxFiles, /<textarea\b/g),
    rawSelectTags: countStripped(tsxFiles, /<select\b/g),
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
    // Same name-anchored style as spinnerKeyframes: an entrance-shaped suffix
    // immediately before the block's `{`. Hyphen-delimited, so camelCase
    // fadeIn / menuAppear (the blessed globals) never match.
    privateEntranceKeyframes: countMatches(
      cssFiles,
      /@keyframes\s+\S*(?:-in|-appear|-rise|-slide)\s*\{/gi,
    ),
    dialogRoles: countMatches(tsxFiles, /role="dialog"/g),
    portalFiles: tsLikeFiles.filter((f) => f.content.includes('createPortal(')).length,
    // A hand-rolled point-anchored popover shell = viewport clamp + its own
    // createPortal exit. ui/ is excluded (Popover IS the blessed shell); test
    // files are already excluded by collectFiles.
    bespokePopoverPositioning: tsxFiles.filter(
      (f) =>
        !f.path.includes('/components/ui/') &&
        f.content.includes('useViewportClampedPosition') &&
        f.content.includes('createPortal('),
    ).length,
    // Widened 2026-07-08 (was componentWindowKeydown: window-only, scoped to
    // /components/) — now both window.addEventListener('keydown' AND
    // document.addEventListener('keydown', across ALL of src/renderer/src.
    // Comment-stripped like the tag counters, so doc mentions don't count.
    // The CANONICAL keyboard primitives are exempt: they ARE the blessed
    // implementation this counter pushes listeners toward — counting them
    // would conflate the solution with the problem and force a baseline
    // raise every time a new blessed hook lands.
    handRolledKeydown: countStripped(
      tsLikeFiles.filter(
        (f) =>
          ![
            'src/renderer/src/hooks/useEscapeClose.ts',
            'src/renderer/src/hooks/useMenuKeyboardNav.ts',
            'src/renderer/src/components/ui/hooks/useFocusTrap.ts',
          ].includes(f.path),
      ),
      /(?:window|document)\.addEventListener\('keydown'/g,
    ),
    hardcodedColorLiterals: cssFiles.reduce(
      (sum, f) =>
        sum +
        f.content
          .split('\n')
          .filter((line) => !/--[a-zA-Z0-9_-]+\s*:/.test(line))
          .reduce((n, line) => n + (line.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|oklch\(/g) ?? []).length, 0),
      0,
    ),
    // Exemption requires a SHADOW token specifically — a line like
    // `box-shadow: 0 1px 2px var(--border)` is token-colored but
    // literal-geometry and still counts (review finding: any-var( was too
    // loose and did not match what conventions/frontend.md promises). C0
    // hygiene fix: also exempt a line whose value is WHOLLY `none` (not a
    // shadow at all) or WHOLLY a shadow-purpose token reference that isn't
    // spelled `var(--shadow...)` (e.g. `var(--nodes-shadow)`) — a mixed line
    // (geometry plus any var, shadow-purpose or not) still counts.
    shadowLiterals: cssFiles.reduce(
      (sum, f) =>
        sum +
        f.content
          .split('\n')
          .filter((line) => {
            if (!/box-shadow\s*:/.test(line)) return false;
            if (line.includes('var(--shadow')) return false;
            const value = line
              .replace(/.*box-shadow\s*:\s*/, '')
              .replace(/;.*$/, '')
              .trim();
            if (value === 'none') return false;
            if (/^var\(--[a-zA-Z0-9_-]*shadow[a-zA-Z0-9_-]*\)$/i.test(value)) return false;
            return true;
          })
          .length,
      0,
    ),
    zIndexHighRaw: cssFiles.reduce(
      (sum, f) =>
        sum +
        f.content.split('\n').filter((line) => {
          if (line.includes('var(')) return false;
          const match = line.match(/z-index\s*:\s*(-?\d+)/);
          return match !== null && Number(match[1]) >= 10;
        }).length,
      0,
    ),
    // CSS rule openers outside ui/ shaped like the `-section-{title,desc,
    // body}` or `-field` clusters ui/SectionHeader + ui/FieldRow absorb.
    sectionFieldCssClusters: cssFiles.filter((f) => !f.path.includes('/components/ui/')).reduce(
      (sum, f) =>
        sum +
        (f.content.match(/^\.[a-z][a-z0-9-]*-section-(?:title|desc|body)\s*\{/gm) ?? []).length +
        (f.content.match(/^\.[a-z][a-z0-9-]*-field\s*\{/gm) ?? []).length,
      0,
    ),
    // A hand-rolled trigger-anchored dropdown shell = the useClickOutside +
    // useMenuKeyboardNav pair without a createPortal exit (that combination
    // WITH createPortal is a point-anchored shell — ui/Popover's territory,
    // already excluded by portalFiles/bespokePopoverPositioning above).
    bespokeDropdownShells: tsxFiles.filter(
      (f) =>
        !f.path.includes('/components/ui/') &&
        f.content.includes('useClickOutside(') &&
        f.content.includes('useMenuKeyboardNav(') &&
        !f.content.includes('createPortal('),
    ).length,
    // role="tablist"/role="radiogroup" outside ui/ — the shape
    // ui/SegmentedControl absorbs.
    segmentedRoles: countStripped(
      tsxFiles.filter((f) => !f.path.includes('/components/ui/')),
      /role="(?:tablist|radiogroup)"/g,
    ),
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
