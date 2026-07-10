# ui/ showcase — Playwright visual-regression baseline

Screenshot baseline for `src/renderer/src/components/ui/` (the blessed
design-system set). Built as the prerequisite for
[`docs/ui-reuse-burndown.md`](../../../docs/ui-reuse-burndown.md)'s Batch C3
("radius/shadow normalization, screenshot-diffed per surface").

## What this is (and isn't)

- A **plain browser React page** (`src/Showcase.tsx`, mounted by
  `src/main.tsx`) that imports the real renderer's `styles.css` and renders
  every `components/ui/` piece — Button, Modal, Drawer, Popover,
  DropdownShell, Select, TextField, SectionHeader, FieldRow, SegmentedControl
  — in their meaningful variants/states. `Portal` and the two exported hooks
  (`useDragResize`, `useIndexNav`) have no visual chrome of their own and
  aren't given their own section — see the top comment in `Showcase.tsx`.
- It has **zero Electron/preload imports** by construction — every `ui/`
  piece only imports React, DOM APIs, and local hooks/CSS, so this runs as a
  vanilla `vite` page. It does **not** cover full-app panels (those compose
  `ui/` pieces with app state, Electron IPC, etc.) — those still need a real
  Electron app and the `harness/tools/driver/` harness locally.
- Screenshots are **Linux-rendered only**. Fonts differ per OS, so a macOS
  run against these baselines WILL diff on font metrics alone — that is not
  a regression, don't "fix" it by widening the diff threshold. Run this in a
  Linux container (this repo's cloud sessions, CI-like environments) or
  accept that local baseline updates on macOS are not comparable.

## Run it

```bash
# from apps/canvas-workspace
pnpm run visual          # compare against committed baselines
pnpm run visual:update   # regenerate baselines (review the diff before committing)
```

Both scripts run `playwright test --config=harness/tools/ui-showcase/playwright.config.ts`.
Playwright's `webServer` builds the showcase (`vite build`) and serves the
production bundle (`vite preview`) — not the dev server — for the most
deterministic result (no HMR client, no dev-only module-graph timing).

`visual` is **not** part of `pnpm test` (vitest) — it's platform-bound
(Linux-only baselines) and would break `test` on any non-Linux contributor
machine. Keep it opt-in.

## Why chromium needs an explicit path

This container pre-installs Chromium at `/opt/pw-browsers/chromium`
(`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`), but the pinned
`@playwright/test` version's own revision-probing looks for a different
build id than what's actually installed (confirmed empirically — a bare
`chromium.launch()` fails looking for `chromium_headless_shell-1228`; the
installed revision is `-1194`). `playwright.config.ts` works around this
with an explicit `launchOptions.executablePath` rather than relying on
Playwright's auto-resolution. **Never run `playwright install`** — it will
try to download a browser this container has no network path for; the
pinned build already works once you point at it explicitly.

## Determinism

Screenshots must be pixel-identical run over run in the same environment.
What makes that true here:

- A showcase-only global override (`src/showcase.css`) kills CSS animation,
  transition, and caret blinking (`animation: none !important; transition:
  none !important; caret-color: transparent !important;` on `*`). This file
  is never copied into the real app.
- Fixed viewport (1200×900), `deviceScaleFactor: 1`, `colorScheme: 'light'`
  (`playwright.config.ts`).
- The test waits on `document.fonts.ready` before every capture.
- Modal/Drawer/Popover portal to `document.body` as viewport-fixed overlays
  with no shared containing block, so they can't all be "open" on the page
  at once without painting on top of each other (Modal's blurred backdrop
  in particular would visually corrupt anything under it). They stay CLOSED
  by default; the Playwright spec opens → screenshots → closes each one in
  turn. Select and DropdownShell don't portal (both are documented as
  trigger-anchored, `position: absolute`, in-flow — see their own doc
  comments), so those render open safely.
- Text inputs go `:focus-visible` on click OR programmatic `.focus()` in
  this Chromium build (confirmed empirically); plain `<button>`s only go
  `:focus-visible` via real keyboard navigation. That's why the TextField
  section's "focused" example is reproducible via a script-driven
  `.click()`, while the auto-focused first item inside an opened
  Select/DropdownShell menu never shows a ring (also confirmed stable, just
  always absent rather than sometimes-present).
- Select's and DropdownShell's open panels are `position: absolute` and
  overflow their section's own layout box — a plain `locator.screenshot()`
  on the section crops the panel out. `tests/ui-showcase.visual.ts`'s
  `screenshotUnion()` helper unions the section's and panel's bounding
  boxes and clips a `page.screenshot()` to that instead.

Verified: two full `pnpm run visual` runs from a clean state (killed
preview server, deleted `dist/`, fresh `vite build` each time) produced
zero diffs against the same baselines (`expect.toHaveScreenshot.maxDiffPixels: 0`).

## Updating baselines

1. Make your `components/ui/` change.
2. `pnpm run visual:update` from `apps/canvas-workspace`.
3. Look at the diff in `tests/__screenshots__/` (`git diff` won't render
   PNGs usefully — open the changed files) and confirm the change is the
   one you intended.
4. Commit the updated baselines alongside the source change, in the same
   commit — same rule the ratchet baselines in
   `src/main/__tests__/ui-reuse-governance.test.ts` follow.

Baseline PNGs are a deliberate exception to the repo-wide `*.png` block in
the root `.gitignore` (see the comment there) — they're this tool's actual
output, not incidental generated artifacts.

## Layout

```
harness/tools/ui-showcase/
  index.html            vite entry
  vite.config.ts         plain React page (no electron-vite)
  tsconfig.json           isolated scope — NOT part of the app's
                           tsconfig.json/tsconfig.node.json include globs,
                           and not wired into `pnpm typecheck`; check it
                           separately with
                           `tsc --noEmit -p harness/tools/ui-showcase/tsconfig.json`
  playwright.config.ts    webServer (build+preview), fixed chromium path,
                           viewport, snapshot path template
  src/
    main.tsx              mounts Showcase, imports the real styles.css
    Showcase.tsx           the grid — one section per ui/ piece
    showcase.css            determinism overrides + showcase-only layout
  tests/
    ui-showcase.visual.ts   the one spec file (deliberately not named
                             `*.spec.ts`/`*.test.ts` — see its top comment)
    __screenshots__/         committed baselines
```
