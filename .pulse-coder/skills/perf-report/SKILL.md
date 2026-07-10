---
name: perf-report
description: Run the canvas-workspace performance evaluation, publish the latest static dashboard through the local nginx/Cloudflare Tunnel route, capture a screenshot, and summarize the report. Use when the user asks to run Pulse Canvas/canvas-workspace perf checks, deploy the performance dashboard, refresh https://jasperhu.art/apps/canvas-perf/, or send a dashboard screenshot from Feishu/remote-server.
---

# Perf Report Skill

Drive one round of the canvas-workspace performance evaluation and deliver the
result three ways: a structured summary, a deployed static dashboard, and PNG
screenshots that remote-server can send back to Feishu.

The pipeline is fully deterministic (no LLM at report time). Stable definitions
live in `apps/canvas-workspace/perf/program.md` + `perf/metrics.json`; all target,
warning, and Gate numbers live only in `perf/baselines.json → policies`.

## One Command

From the repository root, prefer the bundled script:

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/perf-report/scripts/run-publish-dashboard.mjs"
```

Default behavior is resource-conscious for this host: build once with
`NODE_OPTIONS=--max-old-space-size=1024`, run `perf:report --no-build --repeat
1 --seed-nodes 100`, publish to nginx, then capture a screenshot.
It also captures the live Electron window right after startup and before the
interaction scenarios run.

Variants:
- `--repeat 3` — closer to CI median behavior; heavier
- `--seed-nodes 300` — larger canvas for interaction scenarios
- `--no-build` — reuse existing `dist/`
- `--no-screenshot` — skip the dashboard webpage screenshot; the Electron
  startup screenshot is still captured during `perf:report`
- `--strict` — exit non-zero when perf gates fail even if publish succeeds

The deployed dashboard URL is:

```text
https://jasperhu.art/apps/canvas-perf/
```

Host prerequisites: `xvfb-run`, Electron runtime libraries, and a Chinese font
such as `google-noto-sans-cjk-sc-fonts` must be installed. Without the font,
server-side screenshots render Chinese as square boxes.

Override deployment with:

```bash
PULSE_CANVAS_PERF_DEPLOY_DIR=/path/to/static \
PULSE_CANVAS_PERF_PUBLIC_URL=https://example.com/perf/ \
node "${CODEX_HOME:-$HOME/.codex}/skills/perf-report/scripts/run-publish-dashboard.mjs"
```

## Manual Steps

Use these only when debugging the pipeline:

```bash
pnpm --filter canvas-workspace build
pnpm --filter canvas-workspace perf:report --no-build --repeat 1
node "${CODEX_HOME:-$HOME/.codex}/skills/perf-report/scripts/publish-dashboard.mjs"
```

`publish-dashboard.mjs` copies:

- `perf/out/dashboard.html` → `/data/www/sites/default/current/canvas-perf/index.html`
- `report.json`, `scenarios-report.json`, `bundle-report.json`
- `renderer-trace-summary.json`, `renderer-trace.json.gz` when CDP tracing is available
- dashboard screenshot → `apps/canvas-workspace/perf/out/dashboard.png`
- Electron startup screenshot → `apps/canvas-workspace/perf/out/electron-startup.png`

The screenshot script prints:

```text
__PULSE_IMAGE_RESULT__{"model":"perf-dashboard-screenshot","outputPath":"...","mimeType":"image/png"}
```

remote-server recognizes one or more of these markers and sends the images
back to Feishu when the run is triggered from Feishu.

## Read the Machine Contract

Read `apps/canvas-workspace/perf/out/report.json`:

- `verdict` — one-line machine-generated conclusion
- `policyVersion` — target/Gate contract version
- `targetSummary` — configured/applicable/measured counts plus
  `met`/`nearWarning`/`missed`/`pending`/`notApplicable`
- `p0Targets[]` — P0-only id/value/target/warning/headroom/status details;
  use this list for the headline target readout instead of inferring priority
- `gateSummary` — independent `passed`/`failed`/`total` Gate counts
- `policyEvaluations` — target, warning, confidence, profile, headroom, target
  status, and Gate status by metric id (including configured-but-unmeasured ids)
- `alerts[]` — severity (`high`/`medium`/`info`), `title`, `evidence`,
  `suggestion` (the actionable fix), `ref` (finding id, e.g. `I-1`, `A2`)
- `metrics[]` — metric id → value + resolved `policy`; `pass`/`limit`/
  `gateOperator` refer only to the independent Gate
- `coverage.measured/total` — required core metrics only
- `coverage.diagnostic` — optional CDP trace metrics; unavailable diagnostics
  do not make the core report fail
- `diagnostics.rendererTrace` — warm renderer reload trace status/profile and
  `perf/out/renderer-trace.json.gz` artifact metadata

## Reply

Report, in this order: the `verdict` verbatim → missed/near-warning P0 targets →
`high` Gate alerts (if any) → other `medium` alerts with their `suggestion` and
`ref` → coverage → deployed URL → screenshot path. Keep it short; the dashboard
carries the detail. Never describe a passing Gate as “目标达成”.

## Rules

- Never edit `report.json`/`dashboard.html` by hand — regenerate.
- Never claim the screenshot was sent unless `dashboard.png` exists and the
  remote-server image markers were printed or uploaded.
- Target status and Gate status are independent. A target miss identifies
  improvement work but does not fail the command; an applicable Gate fail or
  unavailable value fails closed. Never collapse the two into one green/red.
- Timing targets apply only to their exact measurement profile (machineId, OS,
  arch, seedNodes, seedWebpages, repeat, fixture, headless). Do not compare across profiles; report a mismatch
  as `not-applicable`. Counter metrics use the global deterministic profile.
- `startup.renderer_reload.*` is record-only Electron `file://` lab evidence,
  not field Core Web Vitals. Report LCP/CLS reference ratings with the warm
  reload/profile qualifier. Keep FCP→Canvas shell blocking separate from
  Canvas→LCP blocking and Long Task evidence; neither is Lighthouse TBT.
- Never interpret a numeric zero without its sample contract. Pan/zoom uses
  wheel→next-frame latency (wheel INP is N/A), frame medians must be paired
  with their single-run max, and cache hit ratio is valid only when the report
  includes a non-zero settled-render opportunity count.
- If you fix a finding an alert points to (e.g. `I-1`), lower the matching
  baseline/max in `perf/baselines.json` in the same change — the alert
  disappearing on the next run is the proof of the fix.
- A `high` alert (gate failure) outranks whatever else you were doing:
  surface it to the user before continuing.
