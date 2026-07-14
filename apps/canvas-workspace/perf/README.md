# Performance evaluation

Ratchet-gated performance checks for canvas-workspace. Guards derive from the
findings in `../docs/performance-analysis-consolidated.md` (+ round 3).
System design — the six aspects, the full metric dictionary (IDs, definitions,
gate levels), recording schema, and roadmap — lives in **`program.md`** (SSOT);
this file only covers how to run things.

The bundle/install-size workstream has a self-contained execution handoff in
**`bundle-optimization-plan.md`**: verified baselines, achievable targets,
phased task cards, risks, and acceptance commands. Agents changing build
minification, lazy boundaries, dependency classification, or packaging should
read it before implementation.

For a presentation-friendly view of the current state, actions, and expected
benefits, open **`bundle-optimization-overview.html`** directly in a browser.

After producing a macOS arm64 release, run `pnpm --filter canvas-workspace
perf:package` to record DMG, unpacked app, ASAR, native unpacked, and Electron
locale metrics in `perf/out/package-report.json`.

## One command (start here)

```bash
pnpm --filter canvas-workspace perf:report
```

Runs the whole pipeline — build → bundle gate → launch the app headless →
runtime scenarios → close → assemble the report — prints the verdict, and
writes `out/dashboard.html` (open in a browser) + `out/report.json` (verdict +
target/Gate summaries + alerts + metrics, for agents/CI). Exit 1 if any Gate failed or a full report
does not cover every **core** metric in `metrics.json` (`--bundle-only` is
exempt). Optional CDP-trace diagnostics have their own coverage status and do
not make the core report fail when the browser protocol is unavailable.

Variants: `--bundle-only` (fast, no app launch), `--no-build` (reuse `dist/`),
`--seed-nodes 300` (larger canvas), `--repeat 1` (single boot — faster but
noisier; default is 3, see below). A full report deletes any stale
`out/scenarios-report.json` before launch and exits non-zero if the app can't
launch or the replacement runtime report is missing or invalid; use
`--bundle-only` when a runtime run is intentionally out of scope. First run on a display-less host
needs `apt-get install -y xvfb` and, if the Electron binary is missing,
`pnpm --filter canvas-workspace setup:electron`.
The CDP driver also needs a Node runtime with a global `WebSocket`; Node 20
fails with `WebSocket is not defined`, while the repository's current Node 24
runtime works.

Agents use the same command via the `perf-report` skill
(`.pulse-coder/skills/perf-report/SKILL.md`).

The individual steps below are exposed for debugging / partial runs.

## Bundle (no app launch needed)

```bash
pnpm --filter canvas-workspace build
pnpm --filter canvas-workspace perf:bundle
```

Measures the built renderer (entry raw/gzip, total JS, heavy-lib probes),
compares against the bundle-scoped policies in `baselines.json`, writes `out/bundle-report.{json,html}`.
Exit 1 on regression. The static companion gate `src/main/__tests__/bundle-boundaries.test.ts`
runs with the normal test suite and keeps mermaid dynamic-only.

**A5 · per-dependency attribution**: `PULSE_CANVAS_PERF_ANALYZE=1 pnpm build`
turns on `entryDepStatsPlugin` (electron.vite.config.ts) — reads Rollup's own
per-chunk module render-size stats (no new dependency, no extra build cost)
and writes `out/entry-dep-stats.json`. `perf:bundle` picks it up automatically
if present and adds `entryDepAttribution` (per-package KB + app's own code) to
`bundle-report.json`; `perf:report` always sets the env var, so a normal
`perf:report` run has this by default. Missing the file (e.g. `perf:bundle`
run standalone without the flag) just omits the section — no error.

## Runtime scenarios (drives the real app)

```bash
pnpm --filter canvas-workspace setup:electron    # only if the binary download was skipped/blocked
pnpm --filter canvas-workspace build
node harness/tools/driver/cli.mjs start --profile temp --headless   # display-less Linux; omit --headless on a desktop (see harness/tools/driver/README.md)
pnpm --filter canvas-workspace perf:scenarios -- --seed-nodes 100
node harness/tools/driver/cli.mjs close --cleanup
```

## Dashboard (from real data)

```bash
pnpm --filter canvas-workspace perf:dashboard
```

Normalizes whatever reports exist in `out/` into the recording schema
(`out/metrics-latest.json`, plus an append to `history/` for per-machine
trends), runs the rule engine, and emits two artifacts: `out/dashboard.html`
for humans and `out/report.json` (verdict + alerts + metrics) for agents.
Metric definitions come from `metrics.json`; metrics without values render as
未建/已埋待采 so coverage gaps stay visible. Within each topic, the dashboard
shows `primary` metrics as P0 summary cards, groups `supporting` metrics by
dimension under P1, and keeps `diagnostic` evidence under P2. P1/P2 groups are
collapsed by default, but a failed or directly-alerted metric opens its group
automatically. `level` (gate behavior), `coverageClass` (report completeness),
and `displayPriority` (visual hierarchy) are deliberately independent.

Coding agents consume this via the `perf-report` runtime skill
(`.pulse-coder/skills/perf-report/SKILL.md`): run the pipeline, read
`report.json`, summarize verdict/alerts, and pin the dashboard to the canvas
with `artifact_create` + `artifact_pin_to_canvas`.

Scenarios drive input via CDP and read `window.__pulsePerf`:

| Scenario | What it does | Gate |
|---|---|---|
| `startup` | parses the `[perf] startup` main-process phase line + renderer marks | informational |
| `renderer-trace` | reloads the built renderer once under CDP, records lab LCP/CLS, shift count, FCP→Canvas and Canvas→LCP blocking, Long Tasks + CPU counters, and saves a compressed Chrome trace | diagnostic/record-only |
| `image-memory` | mounts 10 unique 4000×3000 image nodes and sums decoded pixel bytes | `memory.image.decoded_mb` record |
| `chat-stream` | replays 521 deterministic code/Markdown deltas, then forces one same-content settled rerender | frame rate, Markdown render/cache evidence, Mermaid tail |
| `typing` | types 120 chars into the first file node | `nodes-array-replace` counter (finding I-1) |
| `resize` | resizes a node from its bottom-right corner over 90 steps | `nodes-array-replace` + `canvas-save-ipc` counters (finding A2 resize) |
| `drag` | drags the first node header 90 steps | `nodes-array-replace` counter (finding A2) |
| `panzoom` | pans (plain wheel) + zooms (ctrl+wheel) over blank canvas, verifies transform change, and measures wheel→next-frame latency | response/frame evidence (no nodes-array touch) |
| `pty-stream` | streams deterministic output through two real PTYs and counts renderer `pty:data` events | `main.pty.ipc_per_sec` record |

Resize's Event Timing value only covers discrete pointerdown/up events; it
does not measure continuous pointer-move latency. Treat it as record-only and
use `frames_over20_pct` plus `frames_over20_pct_max` for resize smoothness.
Pan/zoom no longer reports a structural zero INP: wheel is outside the Event
Timing discrete-interaction set, so its response metric is a verified
wheel→next-frame p95 instead. Frame windows freeze after the action's final
double-rAF while save/counter collection continues separately.

`--seed-nodes N` grows the welcome canvas to N nodes (text nodes, persisted +
reload) so timing metrics reflect a loaded canvas.

### CDP trace and Web Vitals diagnostics

The full report also captures `perf/out/renderer-trace.json.gz` plus
`renderer-trace-summary.json`. This uses the harness's existing Electron CDP
connection directly, so CI stays deterministic and does not depend on an MCP
server. The trace is a **warm renderer reload** after the normal 100-node
interaction scenarios, not a cold Electron process launch. The metric ids are
therefore namespaced under `startup.renderer_reload.*` and remain record-only.

LCP and CLS here are desktop Electron `file://` lab signals. They are useful
for detecting renderer loading and layout-stability regressions, but they are
not CrUX/field Core Web Vitals. The existing `interact.*.inp_p95_ms` values are
scenario-scoped Event Timing measurements rather than whole-page field INP.
The trace also separates shell-first-render blocking from Canvas→LCP blocking;
the former can be zero while a later Long Task still delays meaningful content.
Top-level TTFB, cache, render-blocking-network, and Speed Index metrics are not
included because a local `file://` Electron shell does not give them the same
product meaning as a hosted website. Remote webviews should be audited as
separate CDP targets when network behavior is the question.

Chrome DevTools MCP remains useful for interactive drill-down of a live trace,
but the upstream project officially supports Chrome/Chrome for Testing; an
Electron target is best-effort. When configured, connect it to the harness's
dynamic `cdpPort` with `--browser-url=http://127.0.0.1:<port>` rather than
starting an unrelated Chrome profile.

### Repeat / medians (A3)

`perf:report --repeat N` (default 3, min 1) drives two independent repeat
mechanisms so timing metrics stop being single-sample noise:

- **`report.mjs` boots the app N times** for the `startup` scenario — each of
  the first N-1 boots launches fresh, reads the `[perf] startup` phase log,
  and closes; only the Nth stays alive for the interactive scenarios below.
  Phases are folded into a same-machine median (`mergeStartupMedians`) with
  `runs`/`raw[]` recorded per program.md §3's schema.
- **`run-scenarios.mjs --repeat N`** re-drives
  `typing`/`resize`/`drag`/`panzoom` N times against that one live session
  (cheap — no relaunch needed). It records the median and raw repeat samples
  for Event Timing, frame smoothness, and the Pan/Zoom wheel→next-frame probe;
  it also keeps the worst single-run frame percentage/count so a median `0%`
  cannot hide a real slow-frame sample. Deterministic counters take the max
  across runs as a safety net rather than noise smoothing.

`main.loop_delay_p99_ms` gets a smaller, incidental benefit: repeating
typing/resize/drag/panzoom extends the session, giving the loop-delay sampler more 2s
windows to draw its percentile from. `main.loop_delay_max_ms` is not
repeat-stabilized — it's inherently a single worst-case reading, and the
dashboard's variance alert already suggests re-running to confirm outliers on
that metric specifically.

Call `pnpm --filter canvas-workspace perf:scenarios -- --repeat 3` directly
when driving a manually-started session (see below).

## Baseline policy

- `baselines.json → policies` is the only numeric SSOT. `target` is the desired
  product level, `warning` marks a material miss, and `gate` is an independent
  regression guard. A metric can therefore be “未达标” while its Gate still
  passes; only Gate failures make the command exit 1.
- `metrics.json` stores stable semantics (`direction`, `measurementProfile`,
  runtime counter source), never threshold numbers. Configuration validation
  fails closed when a `level:gate` metric has no executable policy Gate.
- Same-machine timing targets apply only when machine id, OS, architecture,
  node/webpage counts, repeat count, fixture version, and actual headless mode
  match the named profile. A mismatch renders
  as “不适用”, not PASS or FAIL. Deterministic counters and build artifacts use
  the global profile.
- Counter Gates use `max`/`min`/`true`; bundle Gates use
  `baseline × (1 + tolerancePct/100)` ratchets. Lower the relevant target or
  Gate in the same PR when a fix creates durable headroom.
- Renderer trace targets remain diagnostic and do not gate CI. Promote one to
  a Gate only after at least five stable runs with the same Electron/Chromium,
  viewport, DPR, headless/GPU mode, machine, and measurement profile.

Reference numbers (2026-07-04, in-sandbox xvfb, temp profile):
startup whenReady→domReady 1598→2358 ms; typing@100 nodes INP p95 48 ms with
43% frames >20 ms; drag@100 nodes INP p95 ~130 ms. Counters: typing 120
replacements /120 keys, drag 91 /90 moves — the I-1/A2 amplifiers, measured.

Current resize result (2026-07-10, macOS headless, 100 nodes, 3 repeats):
per-run node-array replacements `[1,1,1]`, save IPCs `[2,1,1]`; gate maxima
`1` / `2`, and median frames over 20ms = 0%. Both counter gates pass against
their `10` / `3` limits.
