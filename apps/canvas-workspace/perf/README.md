# Performance evaluation

Ratchet-gated performance checks for canvas-workspace. Guards derive from the
findings in `../docs/performance-analysis-consolidated.md` (+ round 3).
System design — the six aspects, the full metric dictionary (IDs, definitions,
gate levels), recording schema, and roadmap — lives in **`program.md`** (SSOT);
this file only covers how to run things.

## One command (start here)

```bash
pnpm --filter canvas-workspace perf:report
```

Runs the whole pipeline — build → bundle gate → launch the app headless →
runtime scenarios → close → assemble the report — prints the verdict, and
writes `out/dashboard.html` (open in a browser) + `out/report.json` (verdict +
alerts + metrics, for agents/CI). Exit 1 if any gate failed.

Variants: `--bundle-only` (fast, no app launch), `--no-build` (reuse `dist/`),
`--seed-nodes 300` (larger canvas), `--repeat 1` (single boot — faster but
noisier; default is 3, see below). Degrades to a bundle-only report if the app
can't launch. First run on a display-less host needs `apt-get install -y xvfb`
and, if the Electron binary is missing, `pnpm --filter canvas-workspace setup:electron`.

Agents use the same command via the `perf-report` skill
(`.pulse-coder/skills/perf-report/SKILL.md`).

The individual steps below are exposed for debugging / partial runs.

## Bundle (no app launch needed)

```bash
pnpm --filter canvas-workspace build
pnpm --filter canvas-workspace perf:bundle
```

Measures the built renderer (entry raw/gzip, total JS, heavy-lib probes),
compares against `baselines.json → bundle`, writes `out/bundle-report.{json,html}`.
Exit 1 on regression. The static companion gate `src/main/__tests__/bundle-boundaries.test.ts`
runs with the normal test suite and keeps mermaid dynamic-only.

## Runtime scenarios (drives the real app)

```bash
pnpm --filter canvas-workspace setup:electron    # only if the binary download was skipped/blocked
pnpm --filter canvas-workspace build
node harness/cli.mjs start --profile temp --headless   # display-less Linux; omit --headless on a desktop (see harness/README.md)
pnpm --filter canvas-workspace perf:scenarios -- --seed-nodes 100
node harness/cli.mjs close --cleanup
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
未建/已埋待采 so coverage gaps stay visible.

Coding agents consume this via the `perf-report` runtime skill
(`.pulse-coder/skills/perf-report/SKILL.md`): run the pipeline, read
`report.json`, summarize verdict/alerts, and pin the dashboard to the canvas
with `artifact_create` + `artifact_pin_to_canvas`.

Scenarios drive input via CDP and read `window.__pulsePerf`:

| Scenario | What it does | Gate |
|---|---|---|
| `startup` | parses the `[perf] startup` main-process phase line + renderer marks | informational |
| `typing` | types 120 chars into the first file node | `nodes-array-replace` counter (finding I-1) |
| `drag` | drags the first node header 90 steps | `nodes-array-replace` counter (finding A2) |

`--seed-nodes N` grows the welcome canvas to N nodes (text nodes, persisted +
reload) so timing metrics reflect a loaded canvas.

### Repeat / medians (A3)

`perf:report --repeat N` (default 3, min 1) drives two independent repeat
mechanisms so timing metrics stop being single-sample noise:

- **`report.mjs` boots the app N times** for the `startup` scenario — each of
  the first N-1 boots launches fresh, reads the `[perf] startup` phase log,
  and closes; only the Nth stays alive for the interactive scenarios below.
  Phases are folded into a same-machine median (`mergeStartupMedians`) with
  `runs`/`raw[]` recorded per program.md §3's schema.
- **`run-scenarios.mjs --repeat N`** re-drives `typing`/`drag` N times against
  that one live session (cheap — no relaunch needed) and medians
  `interactions.p95` / `frames.over20msPct`; counters take the max across runs
  (they're deterministic, so max is a safety net, not smoothing).

`main.loop_delay_p99_ms` gets a smaller, incidental benefit: repeating
typing/drag extends the session, giving the loop-delay sampler more 2s
windows to draw its percentile from. `main.loop_delay_max_ms` is not
repeat-stabilized — it's inherently a single worst-case reading, and the
dashboard's variance alert already suggests re-running to confirm outliers on
that metric specifically.

Call `pnpm --filter canvas-workspace perf:scenarios -- --repeat 3` directly
when driving a manually-started session (see below).

## Baseline policy

- Counter gates are deterministic (exact event counts) — tolerance lives in the
  recorded `max`. Today's maxima document the known amplifiers; when a fix
  lands (e.g. debounced editor sync, ephemeral drag geometry), lower the max in
  the same PR to lock the win in.
- Timing metrics (INP p95, frames >20ms, LoAF, startup phases) are median'd
  across `--repeat` runs (see above) but stay informational until enough
  same-machine history establishes variance; they are recorded in
  `out/scenarios-report.json`.
- Bundle gates fail at `baseline × (1 + tolerancePct/100)`; lower baselines
  when a splitting fix lands.

Reference numbers (2026-07-04, in-sandbox xvfb, temp profile):
startup whenReady→domReady 1598→2358 ms; typing@100 nodes INP p95 48 ms with
43% frames >20 ms; drag@100 nodes INP p95 ~130 ms. Counters: typing 120
replacements /120 keys, drag 91 /90 moves — the I-1/A2 amplifiers, measured.
