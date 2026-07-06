---
name: perf-report
description: Run the canvas-workspace performance evaluation, read the latest metrics and rule-engine alerts, summarize them, and render the dashboard into the UI so both agents and humans can consume it.
description_zh: 运行 canvas-workspace 性能评估,读取最新指标与规则引擎告警,总结结论,并把看板渲染到界面上,供 Agent 与人共同消费。
version: 1.0.0
author: Pulse Coder Team
---

# Perf Report Skill

Drive one round of the canvas-workspace performance evaluation and deliver the
result twice: a structured summary in your reply (for the human and for your
own next optimization step), and the HTML dashboard rendered into the UI.

The pipeline is fully deterministic (no LLM at report time). Definitions live
in `apps/canvas-workspace/perf/program.md` + `perf/metrics.json`; thresholds in
`perf/baselines.json`.

## Workflow

### 1. Run one command (from the repository root)

```bash
pnpm --filter canvas-workspace perf:report
```

That is the whole pipeline: build → bundle gate → launch the app headless →
runtime scenarios → close → assemble the report. It prints the verdict and
writes `perf/out/dashboard.html` + `perf/out/report.json`. Exit code is 1 if
any gate failed (usable directly in CI).

Variants:
- `--bundle-only` — fast, skips the app launch (bundle metrics only)
- `--no-build` — reuse an existing `dist/`
- `--seed-nodes 300` — larger canvas for the interaction scenarios

If the app can't launch, it degrades to a bundle-only report and tells the
user to install Xvfb (`apt-get install -y xvfb`) and, if the Electron binary
is missing, run `pnpm --filter canvas-workspace setup:electron`.

### 2. Read the machine contract

Read `apps/canvas-workspace/perf/out/report.json`:

- `verdict` — one-line machine-generated conclusion
- `alerts[]` — severity (`high`/`medium`/`info`), `title`, `evidence`,
  `suggestion` (the actionable fix), `ref` (finding id, e.g. `I-1`, `A2`)
- `metrics[]` — metric id → value (+ `pass`/`limit` for gated ones)
- `coverage` — how many dictionary metrics have values

### 4. Render to the UI

Preferred: publish the dashboard as an artifact and pin it to the canvas —

1. `artifact_create` with the full content of
   `apps/canvas-workspace/perf/out/dashboard.html` (title: "性能看板").
2. `artifact_pin_to_canvas` so it lives on the canvas next to the work.

Updating later: use `artifact_update` on the same artifact instead of
creating a new one. (Alternative when artifacts are unavailable:
`canvas_create_node` type `iframe` pointing at the dashboard file.)

### 5. Reply with the summary

Report, in this order: the `verdict` verbatim → `high` alerts (if any) →
`medium` alerts with their `suggestion` and `ref` → coverage. Keep it short;
the dashboard carries the detail.

## Rules

- Never edit `report.json`/`dashboard.html` by hand — regenerate.
- Timing metrics are per-machine; do not compare absolute values across
  machines or declare regressions from a single run (the variance alert
  exists for this). Counter metrics are deterministic and safe to act on.
- If you fix a finding an alert points to (e.g. `I-1`), lower the matching
  baseline/max in `perf/baselines.json` in the same change — the alert
  disappearing on the next run is the proof of the fix.
- A `high` alert (gate failure) outranks whatever else you were doing:
  surface it to the user before continuing.
