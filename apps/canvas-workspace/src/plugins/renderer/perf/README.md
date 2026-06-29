# Perf plugin (detachable)

In-app performance observability panel, built on the Canvas plugin mechanism.
**Off by default, zero cost when off**, and fully detachable.

## What it surfaces

- **Live renderer metrics**: FPS, JS heap (`performance.memory`), long tasks
  (`PerformanceObserver('longtask')`).
- **Per-process CPU / memory** and process-type counts via the main half
  (`app.getAppMetrics()`) — `Tab` rows are guest webview renderers (validates
  findings D1 / H2).
- **Startup (time-to-window)**: main-process bootstrap phase breakdown
  (whenReady → seeded → toolsEnv → plugins → openWindow → windowLoaded) plus
  the renderer start → first-render delta. Main-process marks require
  launching with `PULSE_PERF=1`; renderer marks are always recorded.
- **Latest CI snapshot** (`perf/out/perf-snapshot.json`, produced by
  `pnpm --filter canvas-workspace perf:report`).

## How it integrates (Canvas plugin mechanism)

Two halves wired through the existing plugin contracts — no core coupling
beyond two registrations and one flag entry:

| Half | File | Uses |
|---|---|---|
| renderer | `src/plugins/renderer/perf/` | `RendererCtx.registerRoute` + `registerNavItem` + `invoke` |
| main | `src/plugins/main/perf.ts` | `MainCtx.handle('metrics' \| 'snapshot')` (pull-based, inert until invoked) |

**Two gates:**

1. **Build-time** — `__PERF_TOOLS__` (injected by `electron.vite.config.ts`).
   `false` for production builds, so the renderer half is behind a
   `__PERF_TOOLS__`-guarded dynamic `import()` in `main.tsx` (dead-code
   eliminated → PerfPage + CSS never bundled) and the main half is dropped from
   `BUILT_IN_MAIN_PLUGINS` via a `__PERF_TOOLS__ ?` spread (tree-shaken).
   Included in dev; force into a build with `PULSE_PERF_TOOLS=1`.
2. **Runtime** — the `perf-panel` experimental flag (Settings → Experimental,
   needs a window reload). Even in a dev build the panel stays hidden until the
   flag is on.

So a packaged app ships **none** of this code; a dev build ships it but inert
until you flip the flag.

## Boundaries (what stays out of the plugin)

- **L1 bundle / L2 bench** are build/CI-time scripts (`pnpm perf:bundle`,
  `pnpm bench`); a runtime plugin cannot measure its own build. The panel only
  *reads* their snapshot output.
- **Startup marks (L3)** live in core `bootstrap.ts` / `main.tsx` (the plugin
  activates too late to time window-open), gated by `PULSE_PERF`. The plugin
  only *reads* them via `getStartupReport()` — core never depends on the plugin,
  so removing the plugin leaves the (inert, gated) marks harmlessly in place.

## Removing it completely

1. Delete `src/plugins/renderer/perf/` and `src/plugins/main/perf.ts`.
2. Remove the `__PERF_TOOLS__`-guarded perf import block in
   `src/renderer/src/main.tsx` and the `PerfMainPlugin` spread in
   `src/plugins/main/built-in.ts`.
3. Remove `EXPERIMENTAL_FLAG_PERF_PANEL` (constant + descriptor) from
   `src/shared/experimental-features.ts`.

Nothing else references it. (The `__PERF_TOOLS__` define and `perf-marks.ts`
can stay — they are independently useful and already stripped from production.)
